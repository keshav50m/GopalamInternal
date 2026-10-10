import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePersistentImageUrl,
  parseImageFetchProvider,
  resolveImageCandidates,
} from "../src/utils/imageProvider.ts";
import { loadWithImageFallback } from "../src/utils/pdfImagePipeline.ts";
import { getRemovedImageCandidates } from "../src/utils/productImageRemoval.ts";

const cloudinary = "https://res.cloudinary.com/demo/image/upload/v1/item.jpg";
const r2 = "https://images.example.com/products/item.jpg";

test("Cloudinary is primary by default and R2 is fallback", () => {
  assert.deepEqual(resolveImageCandidates({ image: cloudinary, r2Image: r2 }), {
    primaryUrl: cloudinary,
    fallbackUrl: r2,
    primaryProvider: "cloudinary",
    fallbackProvider: "r2",
  });
});

test("R2 is primary only for the supported r2 setting", () => {
  assert.equal(resolveImageCandidates({ image: cloudinary, r2Image: r2, provider: "r2" }).primaryUrl, r2);
  assert.equal(parseImageFetchProvider("unsupported"), "cloudinary");
  assert.equal(parseImageFetchProvider(null), "cloudinary");
});

test("missing or invalid primary selects the valid secondary", () => {
  assert.equal(resolveImageCandidates({ image: "", r2Image: r2 }).primaryUrl, r2);
  assert.equal(resolveImageCandidates({ image: cloudinary, r2Image: "not-a-url", provider: "r2" }).primaryUrl, cloudinary);
});

test("empty, null, undefined, and blob values are not persistent candidates", () => {
  for (const value of ["", null, undefined, "blob:https://app.example/temporary"]) {
    assert.equal(normalizePersistentImageUrl(value), "");
  }
  assert.deepEqual(resolveImageCandidates({ image: null, r2Image: undefined }), {
    primaryUrl: "",
    fallbackUrl: "",
    primaryProvider: null,
    fallbackProvider: null,
  });
});

test("an explicitly removed barcode does not inherit an Item No image", () => {
  assert.deepEqual(getRemovedImageCandidates(true), {
    primaryUrl: "",
    fallbackUrl: "",
    image: "",
    r2Image: "",
  });
  assert.equal(getRemovedImageCandidates(false), null);
});

test("PDF acquisition tries primary once and fallback once", async () => {
  const attempts: string[] = [];
  const result = await loadWithImageFallback(r2, cloudinary, async (url) => {
    attempts.push(url);
    return url === cloudinary ? "decoded" : null;
  });
  assert.equal(result, "decoded");
  assert.deepEqual(attempts, [r2, cloudinary]);
});

test("PDF acquisition does not loop when both candidates fail", async () => {
  const attempts: string[] = [];
  const result = await loadWithImageFallback(r2, cloudinary, async (url) => {
    attempts.push(url);
    return null;
  });
  assert.equal(result, null);
  assert.deepEqual(attempts, [r2, cloudinary]);
});
