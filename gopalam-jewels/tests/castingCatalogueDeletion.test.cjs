const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const { NextRequest } = require("next/server");

const token = "a".repeat(32);
const routeContext = (value = token) => ({ params: Promise.resolve({ token: value }) });
const request = () => new Request("http://localhost/api/casting-catalogues/" + token, { method: "DELETE" });

function setup({ authenticated = true, role = "admin", databaseFails = false } = {}) {
  const records = [{ token, title: "Test", productBarcodes: ["B1", "B2"], active: true, createdAt: new Date() }];
  const updates = [];
  const collection = {
    async updateOne(query, update) {
      if (databaseFails) throw new Error("Sensitive database diagnostic");
      updates.push({ query, update });
      const record = records.find((item) => item.token === query.token);
      if (record) Object.assign(record, update.$set);
      return { matchedCount: record ? 1 : 0 };
    },
    async findOne(query) {
      return records.find((item) => item.token === query.token && item.active === query.active) || null;
    },
    async countDocuments(query) {
      assert.equal(query.deletedAt.$exists, false);
      return records.filter((item) => !item.deletedAt).length;
    },
    find(query) {
      assert.equal(query.deletedAt.$exists, false);
      const cursor = { sort: () => cursor, skip: () => cursor, limit: () => cursor, toArray: async () => records.filter((item) => !item.deletedAt) };
      return cursor;
    },
  };
  const cache = new Map();
  function load(relativePath) {
    if (cache.has(relativePath)) return cache.get(relativePath);
    const exports = {};
    cache.set(relativePath, exports);
    const source = fs.readFileSync(path.join(__dirname, "..", "src", relativePath), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(compiled, {
      exports, console,
      require(name) {
        if (name === "@/lib/auth") return { requireAuthenticatedUser: async () => authenticated ? { user: { role } } : { response: new Response("Unauthorized", { status: 401 }) } };
        if (name === "@/lib/castingSharedCatalogues") return { getCastingSharedCataloguesCollection: async () => collection, ensureCastingSharedCatalogueIndexes: async () => {} };
        if (name === "@/lib/mongodb") return { default: Promise.resolve({ db: () => { throw new Error("Deletion must not access product or enquiry collections"); } }) };
        if (name === "@/lib/imageRead" || name === "@/lib/castingCatalogueSelection") return {};
        if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
        return require(name);
      },
    });
    return exports;
  }
  return { load, records, updates };
}

const deletionRoute = "app/api/casting-catalogues/[token]/route.ts";
const listRoute = "app/api/casting-catalogues/route.ts";
const publicRoute = "app/api/catalogue/[token]/route.ts";

test("only authenticated admins may delete catalogue links", async () => {
  for (const [options, expected] of [[{ authenticated: false }, 401], [{ role: "staff" }, 403]]) {
    const instance = setup(options);
    assert.equal((await instance.load(deletionRoute).DELETE(request(), routeContext())).status, expected);
    assert.equal(instance.updates.length, 0);
  }
});

test("invalid and unknown tokens cannot modify a catalogue", async () => {
  const instance = setup();
  const handler = instance.load(deletionRoute).DELETE;
  assert.equal((await handler(request(), routeContext("invalid"))).status, 404);
  assert.equal(instance.updates.length, 0);
  assert.equal((await handler(request(), routeContext("b".repeat(32)))).status, 404);
  assert.equal(instance.records[0].active, true);
});

test("deleting a link revokes public access, hides history, and preserves the record", async () => {
  const instance = setup();
  const historyRequest = new NextRequest("http://localhost/api/casting-catalogues");
  assert.equal((await (await instance.load(listRoute).GET(historyRequest)).json()).total, 1);
  assert.equal((await instance.load(deletionRoute).DELETE(request(), routeContext())).status, 200);
  assert.equal(instance.records.length, 1);
  assert.equal(instance.records[0].active, false);
  assert.ok(instance.records[0].deletedAt);
  assert.deepEqual(instance.records[0].productBarcodes, ["B1", "B2"]);
  assert.equal((await instance.load(publicRoute).GET(historyRequest, routeContext())).status, 404);
  const history = await (await instance.load(listRoute).GET(historyRequest)).json();
  assert.equal(history.total, 0);
  assert.deepEqual(history.catalogues, []);
  // Repeating a deletion remains safe, e.g. when retrying after a lost response.
  assert.equal((await instance.load(deletionRoute).DELETE(request(), routeContext())).status, 200);
});

test("database failures return a safe error", async () => {
  const response = await setup({ databaseFails: true }).load(deletionRoute).DELETE(request(), routeContext());
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes("Sensitive"), false);
});
