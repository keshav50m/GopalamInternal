import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGoldCatalogueUpdate,
  buildGoldProductUpdate,
} from "../src/lib/goldPersistence.ts";
import {
  GOLD_PRODUCT_FIELDS,
  isCompleteGoldQR,
  parseGoldQRCode,
} from "../src/utils/goldProductData.ts";

const sample = "10812,BANG-202-EM,14 K,EMERALD,6.625,7.041,2.08,0,196950,3767.74";
const blankStoneSample = "10544,BST-5248-GT,14 K,,6.969,8.759,8.95,0,198930,3805.52";

test("Gold QR fields map in their exact schema order", () => {
  assert.deepEqual(GOLD_PRODUCT_FIELDS, [
    "BARCODE", "LOT NO", "KARAT1", "STONE NAME", "NW", "GW",
    "ST WT.", "DI WT.", "TOTAL TAG", "US$",
  ]);
  assert.deepEqual(parseGoldQRCode(sample), {
    BARCODE: "10812",
    "LOT NO": "BANG-202-EM",
    KARAT1: "14 K",
    "STONE NAME": "EMERALD",
    NW: "6.625",
    GW: "7.041",
    "ST WT.": "2.08",
    "DI WT.": "0",
    "TOTAL TAG": "196950",
    "US$": "3767.74",
  });
  assert.equal(isCompleteGoldQR(sample), true);
});

test("blank STONE NAME does not shift later Gold QR fields", () => {
  const parsed = parseGoldQRCode(blankStoneSample);
  assert.equal(parsed["STONE NAME"], "");
  assert.equal(parsed.NW, "6.969");
  assert.equal(parsed.GW, "8.759");
  assert.equal(parsed["TOTAL TAG"], "198930");
  assert.equal(parsed["US$"], "3805.52");
});

test("new Gold product sets sold false only on insert", () => {
  const now = new Date("2026-10-04T00:00:00.000Z");
  const update = buildGoldProductUpdate({
    barcode: "10812",
    data: parseGoldQRCode(sample),
    image: "https://res.cloudinary.com/example/gold.jpg",
    r2Image: "https://images.example.com/gold.jpg",
    hasR2Image: true,
  }, now);

  assert.deepEqual(update.$setOnInsert, { sold: false, createdAt: now });
  assert.equal(Object.prototype.hasOwnProperty.call(update.$set, "sold"), false);
  assert.equal(update.$set.image, "https://res.cloudinary.com/example/gold.jpg");
  assert.equal(update.$set.r2Image, "https://images.example.com/gold.jpg");
  assert.deepEqual(update.$unset, { imageRemoved: "" });
});

test("empty image values do not overwrite persistent saved images", () => {
  const now = new Date("2026-10-04T00:00:00.000Z");
  const item = {
    barcode: "10812",
    data: parseGoldQRCode(sample),
    image: "",
    r2Image: "",
    hasR2Image: true,
  };
  const productUpdate = buildGoldProductUpdate(item, now);
  const catalogueUpdate = buildGoldCatalogueUpdate(item, "BANG-202-EM", now);

  assert.equal(Object.prototype.hasOwnProperty.call(productUpdate.$set, "image"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(productUpdate.$set, "r2Image"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(catalogueUpdate.$set, "image"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(catalogueUpdate.$set, "r2Image"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(productUpdate, "$unset"), false);
});
