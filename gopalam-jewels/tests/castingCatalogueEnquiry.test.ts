import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ENQUIRY_QUANTITY,
  calculatePermittedTotals,
  validateCustomerDetails,
  validateEnquirySelections,
} from "../src/lib/castingCatalogueEnquiryValidation.ts";
import { createCatalogueSelectionId } from "../src/lib/castingCatalogueSelection.ts";

const validSelectionId = "a".repeat(43);

test("validates positive integer quantities and rejects duplicates", () => {
  assert.equal(validateEnquirySelections([{ selectionId: validSelectionId, quantity: 1 }]).error, null);
  assert.match(validateEnquirySelections([{ selectionId: validSelectionId, quantity: 0 }]).error || "", /Quantity/);
  assert.match(validateEnquirySelections([{ selectionId: validSelectionId, quantity: 1.5 }]).error || "", /Quantity/);
  assert.match(validateEnquirySelections([{ selectionId: validSelectionId, quantity: MAX_ENQUIRY_QUANTITY + 1 }]).error || "", /Quantity/);
  assert.match(validateEnquirySelections([
    { selectionId: validSelectionId, quantity: 1 },
    { selectionId: validSelectionId, quantity: 2 },
  ]).error || "", /Invalid/);
});

test("validates and trims per-product customization", () => {
  const result = validateEnquirySelections([{
    selectionId: validSelectionId,
    quantity: 2,
    customization: { ringSize: " 14 ", stoneColor: " Blue ", additionalChanges: " Matte finish " },
  }]);
  assert.equal(result.error, null);
  assert.deepEqual(result.selections[0].customization, {
    ringSize: "14",
    stoneColor: "Blue",
    additionalChanges: "Matte finish",
  });
  assert.match(validateEnquirySelections([{
    selectionId: validSelectionId,
    quantity: 1,
    customization: { additionalChanges: "x".repeat(501) },
  }]).error || "", /too long/);
});

test("validates required customer name and optional mobile format", () => {
  assert.match(validateCustomerDetails({ name: "" }).error || "", /required/);
  assert.match(validateCustomerDetails({ name: "Customer", mobile: "not-a-phone" }).error || "", /valid/);
  assert.deepEqual(validateCustomerDetails({ name: " Customer ", mobile: "+91 98765 43210" }).customer, {
    name: "Customer",
    mobile: "+91 98765 43210",
  });
});

test("totals include only fields enabled by the catalogue", () => {
  const entries = [{ price: "1,250", usd: "10.50", quantity: 2 }];
  assert.deepEqual(calculatePermittedTotals(entries, { price: true, usd: false }), { tagPrice: 2500 });
  assert.deepEqual(calculatePermittedTotals(entries, { price: false, usd: true }), { usd: 21 });
  assert.deepEqual(calculatePermittedTotals(entries, { price: false, usd: false }), {});
});

test("different barcodes always receive separate opaque selection IDs", () => {
  const token = "a".repeat(32);
  assert.notEqual(
    createCatalogueSelectionId(token, "BARCODE-001"),
    createCatalogueSelectionId(token, "BARCODE-002")
  );
});
