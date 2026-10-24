const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const enquiryId = "GJ-20261024-A3CA8DD791";
const catalogueToken = "a".repeat(32);
const accessToken = "b".repeat(43);

function fixture(pdfStatus = "failed") {
  return {
    enquiryId, catalogueToken, customerAccessToken: accessToken,
    pdfStatus, pdfStorageKey: "obsolete-file-key",
    catalogueTitle: "Casting Selection",
    submittedAt: new Date("2026-10-24T10:00:00Z"),
    customer: { name: "Test Customer" },
    visibleFields: { image: false, barcode: true, item: true, stone: true, gross: false, stoneWt: false, dai: false, price: false, usd: false, size: true },
    totalQuantity: 3,
    totals: { tagPrice: 987654, usd: 876543 },
    products: [
      { barcode: "BARCODE-A", itemNo: "SAME-ITEM", quantity: 2, image: "", r2Image: "", visibleDetails: { barcode: "BARCODE-A", item: "SAME-ITEM", stone: "Ruby", price: "987654", usd: "876543", size: "14" }, customization: { ringSize: "14", stoneColor: "Blue", additionalChanges: "Matte finish" } },
      { barcode: "BARCODE-B", itemNo: "SAME-ITEM", quantity: 1, image: "", r2Image: "", visibleDetails: { barcode: "BARCODE-B", item: "SAME-ITEM", stone: "Ruby", size: "15" } },
    ],
  };
}

function harness({ record = fixture(), role = "admin", authenticated = true, render } = {}) {
  const root = path.join(__dirname, "..", "src");
  const cache = new Map();
  let reads = 0;
  const collection = {
    async findOne(query) {
      reads++;
      return Object.entries(query).every(([key, value]) => record[key] === value) ? record : null;
    },
    async updateOne() { throw new Error("PDF download must not write to MongoDB"); },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, {
      exports, Buffer, URL, Date, console, process: { env: {} },
      require(name) {
        if (name === "server-only") return {};
        if (name === "@/lib/r2") throw new Error("PDF download must not access R2 storage");
        if (name === "@/lib/castingCatalogueEnquiries") return { getCastingCatalogueEnquiriesCollection: async () => collection };
        if (name === "@/lib/auth") return { requireAuthenticatedUser: async () => authenticated ? { user: { role } } : { response: new Response("Unauthorized", { status: 401 }) } };
        if (name === "@/lib/castingEnquiryPdf" && render) return { generateCastingEnquiryPdf: render };
        if (name.startsWith("@/")) return load(path.join(root, name.slice(2) + ".ts"));
        if (name.startsWith(".")) return load(path.resolve(path.dirname(file), name + ".ts"));
        return require(name);
      },
    });
    return exports;
  }
  return { load: (name) => load(path.join(root, name)), reads: () => reads, record };
}

const publicRoute = "app/api/catalogue/[token]/enquiry/[enquiryId]/pdf/route.ts";
const adminRoute = "app/api/casting-catalogues/enquiries/[enquiryId]/download/route.ts";
const context = { params: Promise.resolve({ token: catalogueToken, enquiryId }) };
const request = (token = accessToken) => new Request("http://localhost/api/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: token }) });

test("customer receives a PDF with quantities/customization and no hidden prices, without storage", async () => {
  const { load } = harness();
  const response = await load(publicRoute).POST(request(), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("content-disposition"), /attachment/);
  const text = Buffer.from(await response.arrayBuffer()).toString("latin1");
  assert.match(text, /^%PDF-/);
  for (const value of ["BARCODE-A", "BARCODE-B", "Quantity: 2", "Quantity: 1", "Ring size: 14", "Stone color: Blue", "Matte finish"]) assert.ok(text.includes(value), value);
  for (const hidden of ["987654", "876543", "Total Tag Price", "Total USD"]) assert.equal(text.includes(hidden), false, hidden);
});

test("legacy enquiry PDF statuses do not block on-demand generation", async () => {
  for (const status of ["pending", "processing", "ready", "failed", "on-demand"]) {
    const { load } = harness({ record: fixture(status) });
    assert.equal((await load(publicRoute).POST(request(), context)).status, 200, status);
  }
});

test("customer capability and originating catalogue are required", async () => {
  const { load } = harness();
  assert.equal((await load(publicRoute).POST(request("c".repeat(43)), context)).status, 404);
  assert.equal((await load(publicRoute).POST(request(), { params: Promise.resolve({ token: "d".repeat(32), enquiryId }) })).status, 404);
  assert.equal((await load(publicRoute).POST(request(""), context)).status, 404);
});

test("long customization and remarks are preserved in the PDF", async () => {
  const record = fixture();
  record.customer.name = "Customer with a longer name ".repeat(3).slice(0, 80);
  record.catalogueTitle = "A carefully selected jewellery collection ".repeat(3).slice(0, 120);
  record.customer.remarks = "Please confirm the finishing details before making this selection. ".repeat(20).slice(0, 970) + " REMARKS_END_MARKER";
  record.products[0].customization.additionalChanges = "Please use a rose gold finish and confirm the stone color. ".repeat(10).slice(0, 470) + " CUSTOM_END_MARKER";
  const { load } = harness({ record });
  const response = await load(publicRoute).POST(request(), context);
  assert.equal(response.status, 200);
  const text = Buffer.from(await response.arrayBuffer()).toString("latin1");
  assert.ok(text.includes("CUSTOM_END_MARKER"));
  assert.ok(text.includes("REMARKS_END_MARKER"));
});

test("admin PDF download requires authenticated admin access", async () => {
  assert.equal((await harness({ authenticated: false }).load(adminRoute).GET(request(), context)).status, 401);
  assert.equal((await harness({ role: "staff" }).load(adminRoute).GET(request(), context)).status, 403);
  assert.equal((await harness().load(adminRoute).GET(request(), context)).status, 200);
});

test("render failure leaves the enquiry unchanged and a later retry succeeds", async () => {
  let attempts = 0;
  const record = fixture();
  const before = JSON.stringify(record);
  const { load } = harness({ record, render: async () => { if (++attempts === 1) throw new Error("Render failed"); return Buffer.from("%PDF-retry"); } });
  const handler = load(publicRoute).POST;
  assert.equal((await handler(request(), context)).status, 500);
  assert.equal(JSON.stringify(record), before);
  assert.equal((await handler(request(), context)).status, 200);
});

test("simultaneous requests share rendering and repeated requests are limited", async () => {
  let renders = 0;
  const { load } = harness({ render: async () => { renders++; await new Promise((resolve) => setTimeout(resolve, 10)); return Buffer.from("%PDF-test"); } });
  const handler = load(publicRoute).POST;
  const pair = await Promise.all([handler(request(), context), handler(request(), context)]);
  assert.ok(pair.every((response) => response.status === 200));
  assert.equal(renders, 1);
  for (let i = 0; i < 8; i++) assert.equal((await handler(request(), context)).status, 200);
  assert.equal((await handler(request(), context)).status, 429);
});
