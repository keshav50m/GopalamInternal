import assert from "node:assert/strict";
import test from "node:test";
import { GoldSearchValidationError, parseGoldSearch } from "../src/lib/goldSearch.ts";

const parse = (query: string) => parseGoldSearch(new URLSearchParams(query));

test("barcode lookup preserves leading zeros and supports legacy numeric barcodes", () => {
  assert.deepEqual(parse("barcode=00123").clauses[0], { $or: [
    { barcode: { $in: ["00123"] } }, { "data.BARCODE": { $in: ["00123"] } },
  ] });
  assert.deepEqual(parse("barcode=123").clauses[0], { $or: [
    { barcode: { $in: ["123", 123] } }, { "data.BARCODE": { $in: ["123", 123] } },
  ] });
});

test("text search escapes regex metacharacters and uses Gold schema", () => {
  assert.deepEqual(parse("lotNo=BANG.1&karat=14+K&stone=EM").clauses, [
    { "data.LOT NO": { $regex: "^BANG\\.1", $options: "i" } },
    { "data.KARAT1": { $regex: "^14 K$", $options: "i" } },
    { "data.STONE NAME": { $regex: "^EM", $options: "i" } },
  ]);
});

test("range filters read literal dotted fields and reject blank/malformed stored values", () => {
  const clause = parse("stoneWtMax=0").clauses[0];
  const comparisons = clause.$expr.$and;
  assert.equal(comparisons[0].$ne[1], null);
  const number = comparisons[0].$ne[0];
  assert.equal(number.$convert.onError, null);
  const input = number.$convert.input.$trim.input.$replaceAll.input;
  assert.deepEqual(input.$convert.input.$getField, { field: { $literal: "ST WT." }, input: "$data" });
  assert.deepEqual(comparisons[1], { $lte: [number, 0] });
  assert.equal(parse("nwMin=0&nwMax=10").clauses[0].$expr.$and.length, 3);
});

test("reject invalid ranges, oversized input, page sizes and malformed cursors", () => {
  for (const query of ["nwMin=10&nwMax=1", "usdMax=oops", "gwMin=-1", "totalTagMax=Infinity", "pageSize=101", "pageSize=0", "pageSize=1.5", "cursor=not-an-id", "status=invalid", `barcode=${"x".repeat(101)}`]) {
    assert.throws(() => parse(query), GoldSearchValidationError, query);
  }
});

test("combines sold state with cursor pagination and leaves empty ranges inactive", () => {
  const parsed = parse("status=available&cursor=0123456789abcdef01234567&pageSize=50&nwMin=");
  assert.deepEqual(parsed.clauses, [{ sold: { $ne: true } }]);
  assert.equal(parsed.pageSize, 50);
  assert.equal(parsed.cursor, "0123456789abcdef01234567");
  assert.deepEqual(parse("status=sold").clauses, [{ sold: true }]);
  assert.deepEqual(parse("").clauses, []);
});
