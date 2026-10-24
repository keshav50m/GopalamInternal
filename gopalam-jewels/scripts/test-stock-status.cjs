const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const XLSX = require('xlsx');
const React = require('react');

function load(relative, mocks = {}) {
  const filename = path.resolve(relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)((id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`, mocks);
    return require(id);
  }, module, module.exports);
  return module.exports;
}

function databaseFixture() {
  const products = [
    { barcode: '001', isSold: false, image: 'image-a', data: { ITEMNO: 'A', USD: 10 } },
    { barcode: '800314', isSold: true, image: 'image-b', data: { ITEMNO: 'B', USD: 20 } },
  ];
  const matches = (p, query) => (!query.barcode || query.barcode.$in.includes(p.barcode)) && (query.isSold === undefined || p.isSold === query.isSold);
  const collection = {
    find(query) {
      const cursor = { project() { return cursor; }, async toArray() { return structuredClone(products.filter((p) => matches(p, query))); } };
      return cursor;
    },
    async updateMany(query, update) { products.filter((p) => matches(p, query)).forEach((p) => Object.assign(p, update.$set)); },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
    '@/lib/auth': { requireAuthenticatedUser: async () => ({}) },
    '@/lib/databaseIndexes': { ensureProductIndexes: async () => {} },
    '@/lib/mongodb': { __esModule: true, default: Promise.resolve({ db: () => ({ collection: () => collection }) }) },
    '@/lib/imageCatalogueQueries': { findCatalogueImagesByItemNos: async () => [] },
    '@/lib/imageRead': { withResolvedImageFields: (p) => p },
  };
  return { products, mocks };
}
const request = (body) => ({ json: async () => body });

test('sold marking persists globally, preserves product fields, reports unknown codes, and is repeatable', async () => {
  const { products, mocks } = databaseFixture();
  const { POST } = load('src/app/api/saved-products/stock-status/route.ts', mocks);
  const result = await POST(request({ barcodes: ['001', '001', 'missing'], isSold: true }));
  assert.deepEqual(result.body, { matchedBarcodes: ['001'], unmatchedBarcodes: ['missing'] });
  assert.equal(products[0].isSold, true);
  assert.equal(products[0].image, 'image-a');
  assert.deepEqual(products[0].data, { ITEMNO: 'A', USD: 10 });
  assert.equal(products.length, 2);
  assert.equal((await POST(request({ barcodes: ['001'], isSold: true }))).status, 200);
});

test('invalid or unauthenticated sold updates cannot mutate inventory', async () => {
  const { products, mocks } = databaseFixture();
  const { POST } = load('src/app/api/saved-products/stock-status/route.ts', mocks);
  assert.equal((await POST(request({ barcodes: ['001'], isSold: 'true' }))).status, 400);
  mocks['@/lib/auth'] = { requireAuthenticatedUser: async () => ({ response: { status: 401 } }) };
  assert.equal((await load('src/app/api/saved-products/stock-status/route.ts', mocks).POST(request({ barcodes: ['001'], isSold: true }))).status, 401);
  assert.equal(products[0].isSold, false);
});

test('lookups preserve sold state even for older clients requesting restoreStock', async () => {
  const { products, mocks } = databaseFixture();
  const { POST } = load('src/app/api/saved-products/lookup/route.ts', mocks);
  let result = await POST(request({ barcodes: ['800314'] }));
  assert.equal(result.body.products[0].isSold, true);
  result = await POST(request({ barcodes: ['800314'], restoreStock: true }));
  assert.equal(result.body.products[0].isSold, true);
  assert.equal(products[1].image, 'image-b');
  assert.deepEqual(products[1].data, { ITEMNO: 'B', USD: 20 });
  assert.equal(products[0].stockStatusUpdatedAt, undefined);
});

function allElements(element) {
  if (!element || typeof element !== 'object') return [];
  return [element, ...React.Children.toArray(element.props?.children).flatMap(allElements)];
}
for (const qr of [false, true]) {
  for (const file of [false, true]) {
    test(`normal ${qr ? 'QR' : 'barcode'} ${file ? 'Excel' : 'paste'} import keeps sold products red and preserves existing rows`, async () => {
      let rows = [{ barcode: '800314', isSold: true, data: { ITEMNO: 'B' } }, { barcode: 'keep', isSold: true }];
      const calls = [];
      const previousFetch = global.fetch;
      global.fetch = async (_, options) => {
        calls.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ products: [{ barcode: '800314', isSold: true, data: { ITEMNO: 'B' } }] }) };
      };
      const PasteImport = () => null;
      const mocks = {
        react: { ...React, useState: (value) => [value, () => {}] },
        '@/components/PasteImport': { __esModule: true, default: PasteImport },
        '@/components/QRUpdateReview': { __esModule: true, default: () => null },
        '@/utils/resolveProductImage': { resolveProductImageCandidates: () => ({ image: '', r2Image: '', primaryUrl: '', fallbackUrl: '' }) },
      };
      try {
        const Component = load(`src/components/${qr ? 'QRCodeExcelUpload' : 'ExcelUpload'}.tsx`, mocks).default;
        const elements = allElements(Component({ setRows: (update) => { rows = update(rows); } }));
        const value = qr ? '800314,B,STONE,1,2,3,100,4,20' : '800314';
        if (file) {
          const book = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ [qr ? 'qrCode' : 'BARCODE']: value }]), 'Sheet1');
          const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
          await elements.find((el) => el.type === 'input').props.onChange({ target: { files: [{ arrayBuffer: async () => buffer }], value: 'file' } });
        } else {
          await elements.find((el) => el.type === PasteImport).props.onImport(value);
        }
        assert.equal(calls[0].restoreStock, undefined);
        assert.equal(rows[0].isSold, true);
        assert.equal(rows.at(-1).isSold, true);
        assert.equal(rows[1].isSold, true);
        assert.equal(rows.at(-1).barcode, '800314');
        assert.equal(rows.at(-1).data.ITEMNO, 'B');
      } finally { global.fetch = previousFetch; }
    });
  }
}

test('all five PDF versions retain default rows and exclude sold rows only when checked, before unique-item grouping', async () => {
  const fixture = [
    { barcode: 'sold', isSold: true, data: { ITEMNO: 'SAME', 'TAG PRICE': '100', USD: '10' } },
    { barcode: 'available', data: { ITEMNO: 'SAME', 'TAG PRICE': '200', USD: '20' } },
    { barcode: 'other', isSold: false, data: { ITEMNO: 'OTHER', 'TAG PRICE': '300', USD: '30' } },
  ];
  const state = [structuredClone(fixture)], refs = [];
  let stateIndex = 0, refIndex = 0;
  let captured;
  const Dummy = () => null;
  const mocks = {
    react: { ...React,
      useEffect() {}, useMemo: (fn) => fn(),
      useRef(value) { const index = refIndex++; return refs[index] ||= { current: value }; },
      useState(value) {
        const index = stateIndex++;
        if (!(index in state)) state[index] = value;
        return [state[index], (update) => { state[index] = typeof update === 'function' ? update(state[index]) : update; }];
      },
    },
  };
  for (const name of ['productTable', 'MarkSold', 'ExcelUpload', 'QRCodeExcelUpload', 'ProviderAwareImage']) {
    mocks[`@/components/${name}`] = { __esModule: true, default: Dummy };
  }
  for (const name of ['generatePDF', 'generatePDFVersion2', 'generatePDFVersion3', 'generatePDFVersion4', 'generatePDFVersion5']) {
    mocks[`@/utils/${name}`] = { [name]: async (rows) => { captured = { name, rows }; } };
  }
  const Component = load('src/components/ProductLookup.tsx', mocks).default;
  const render = () => { stateIndex = 0; refIndex = 0; return allElements(Component()); };
  const button = (els, text) => els.find((el) => el.type === 'button' && el.props.children === text);
  const labelCheckbox = (els, text) => {
    const label = els.find((el) => el.type === 'label' && React.Children.toArray(el.props.children).some((child) => typeof child === 'string' && child.includes(text)));
    return allElements(label).find((el) => el.type === 'input');
  };
  button(render(), 'Download PDF').props.onClick();
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = () => 0;
  try {
    for (let version = 1; version <= 5; version++) {
      let els = render();
      els.find((el) => el.props?.value === `version${version}`).props.onChange();
      els = render();
      assert.equal(labelCheckbox(els, 'Items in stock only').props.checked, false);
      await button(els, 'Generate PDF').props.onClick();
      assert.equal(captured.name, version === 1 ? 'generatePDF' : `generatePDFVersion${version}`);
      assert.deepEqual(captured.rows.map((row) => row.barcode), ['sold', 'available', 'other']);
      labelCheckbox(els, 'Items in stock only').props.onChange({ target: { checked: true } });
      els = render();
      await button(els, 'Generate PDF').props.onClick();
      assert.deepEqual(captured.rows.map((row) => row.barcode), ['available', 'other']);
      labelCheckbox(els, 'Unique Item No').props.onChange({ target: { checked: true } });
      await button(render(), 'Generate PDF').props.onClick();
      assert.deepEqual(captured.rows.map((row) => row.barcode), ['available', 'other']);
      els = render();
      labelCheckbox(els, 'Unique Item No').props.onChange({ target: { checked: false } });
      labelCheckbox(els, 'Items in stock only').props.onChange({ target: { checked: false } });
    }
    assert.deepEqual(state[0], fixture);
  } finally { global.setTimeout = originalSetTimeout; }
});

for (const qr of [false, true]) {
  for (const file of [false, true]) {
    test(`Mark Sold ${qr ? 'QR' : 'barcode'} ${file ? 'Excel' : 'paste'} updates status without importing product rows`, async () => {
      let stateIndex = 0;
      const PasteImport = () => null;
      let marked, payload;
      const mocks = {
        react: { ...React, useState: (value) => [stateIndex++ === 0 ? true : value, () => {}], useRef: () => ({ current: null }) },
        '@/components/PasteImport': { __esModule: true, default: PasteImport },
      };
      const originalFetch = global.fetch;
      global.fetch = async (url, options) => {
        assert.equal(url, '/api/saved-products/stock-status');
        payload = JSON.parse(options.body);
        return { ok: true, json: async () => ({ matchedBarcodes: ['800314'], unmatchedBarcodes: [] }) };
      };
      try {
        const Component = load('src/components/MarkSold.tsx', mocks).default;
        const elements = allElements(Component({ onMarked: (codes) => { marked = codes; } }));
        const value = qr ? '800314,B,STONE,1,2,3,100,4,20' : '800314';
        if (file) {
          const book = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ [qr ? 'qrCode' : 'BARCODE']: value }]), 'Sheet1');
          const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
          const input = elements.filter((el) => el.type === 'input')[qr ? 0 : 1];
          await input.props.onChange({ target: { files: [{ arrayBuffer: async () => buffer }], value: 'file' } });
          // JSX intentionally dispatches upload without blocking the change event.
          await new Promise((resolve) => setImmediate(resolve));
        } else {
          await elements.find((el) => el.type === PasteImport && el.props.label === (qr ? 'Paste QR Codes' : 'Paste Barcodes')).props.onImport(value);
        }
        assert.deepEqual(payload, { barcodes: ['800314'], isSold: true });
        assert.deepEqual(marked, ['800314']);
      } finally { global.fetch = originalFetch; }
    });
  }
}

test('saving a product again clears its sold status and leaves unrelated products alone', async () => {
  const { products, mocks } = databaseFixture();
  const savedCollection = {
    async bulkWrite(ops) {
      for (const { updateOne } of ops) {
        const existing = products.find((product) => product.barcode === updateOne.filter.barcode);
        if (existing) Object.assign(existing, updateOne.update.$set);
      }
    },
  };
  mocks['@/lib/mongodb'] = { __esModule: true, default: Promise.resolve({ db: () => ({ collection: (name) => name === 'savedProducts' ? savedCollection : { bulkWrite: async () => {} } }) }) };
  const result = await load('src/app/api/saved-products/route.ts', mocks).POST(request({ products: [{ barcode: '800314', image: 'replacement', data: { ITEMNO: 'B', USD: '25' } }] }));
  assert.equal(result.status, 200);
  assert.equal(products[1].isSold, false);
  assert.equal(products[0].stockStatusUpdatedAt, undefined);
  assert.equal(products[1].image, 'replacement');
  assert.equal(products[1].data.USD, '25');
});

test('800314 stays sold through manual barcode and QR lookup, then Save All clears database and row status', async () => {
  const { products, mocks } = databaseFixture();
  products[1].isSold = false;
  const savedCollection = {
    find(query) {
      const cursor = { project() { return cursor; }, async toArray() { return structuredClone(products.filter((p) => query.barcode?.$in.includes(p.barcode))); } };
      return cursor;
    },
    async updateMany(query, update) { products.filter((p) => query.barcode.$in.includes(p.barcode)).forEach((p) => Object.assign(p, update.$set)); },
    async bulkWrite(ops) { for (const { updateOne } of ops) Object.assign(products.find((p) => p.barcode === updateOne.filter.barcode), updateOne.update.$set); },
  };
  mocks['@/lib/mongodb'] = { __esModule: true, default: Promise.resolve({ db: () => ({ collection: (name) => name === 'savedProducts' ? savedCollection : { bulkWrite: async () => {} } }) }) };
  const mark = load('src/app/api/saved-products/stock-status/route.ts', mocks).POST;
  const lookup = load('src/app/api/saved-products/lookup/route.ts', mocks).POST;
  const save = load('src/app/api/saved-products/route.ts', mocks).POST;
  await mark(request({ barcodes: ['800314'], isSold: true }));
  assert.equal(products[1].isSold, true);

  const state = [[{ barcode: '800314', data: null }, { barcode: '001', data: null }]], refs = [], timers = [];
  let stateIndex = 0, refIndex = 0;
  const Dummy = () => null;
  const panelMocks = { react: { ...React,
    useEffect() {}, useMemo: (fn) => fn(),
    useRef(value) { const index = refIndex++; const ref = refs[index] ||= { current: value }; if (Array.isArray(value)) ref.current = value; return ref; },
    useState(value) { const index = stateIndex++; if (!(index in state)) state[index] = value; return [state[index], (update) => { state[index] = typeof update === 'function' ? update(state[index]) : update; }]; },
  } };
  for (const name of ['productTable', 'MarkSold', 'ExcelUpload', 'QRCodeExcelUpload', 'ProviderAwareImage']) panelMocks[`@/components/${name}`] = { __esModule: true, default: Dummy };
  const Component = load('src/components/ProductLookup.tsx', panelMocks).default;
  const render = () => { stateIndex = 0; refIndex = 0; return allElements(Component()); };
  const table = () => render().find((el) => el.props?.handleBarcodeLookup);
  const oldFetch = global.fetch, oldAlert = global.alert, oldWindow = global.window;
  let failSave = true;
  global.window = { setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {} };
  global.alert = () => {};
  global.fetch = async (url, options) => {
    if (url === '/api/saved-products' && failSave) return { ok: false };
    const result = await (url.endsWith('/lookup') ? lookup : save)(request(JSON.parse(options.body)));
    return { ok: result.status === 200, json: async () => result.body };
  };
  try {
    await table().props.handleBarcodeLookup(0, '800314');
    assert.equal(state[0][0].isSold, true);
    assert.equal(products[1].isSold, true);
    table().props.handleQRScan(0, '800314,B,STONE,1,2,3,100,4,20');
    timers.shift()();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state[0][0].isSold, true);
    assert.equal(products[1].isSold, true);
    const saveButton = () => render().find((el) => el.type === 'button' && String(el.props.children).includes('Save All Products'));
    await saveButton().props.onClick();
    assert.equal(state[0][0].isSold, true, 'failed saves must retain sold status');
    failSave = false;
    await saveButton().props.onClick();
    assert.equal(products[1].isSold, false);
    assert.equal(state[0][0].isSold, false);
    assert.equal(products[0].stockStatusUpdatedAt, undefined, 'unsaved rows must remain untouched');
  } finally { global.fetch = oldFetch; global.alert = oldAlert; global.window = oldWindow; }
});
