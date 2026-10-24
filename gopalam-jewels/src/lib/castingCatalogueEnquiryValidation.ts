export const MAX_ENQUIRY_ITEMS = 1000;
export const MAX_ENQUIRY_QUANTITY = 100;
export const MAX_CUSTOMER_NAME_LENGTH = 80;
export const MAX_MOBILE_LENGTH = 30;
export const MAX_REMARKS_LENGTH = 1000;
export const MAX_RING_SIZE_LENGTH = 30;
export const MAX_STONE_COLOR_LENGTH = 80;
export const MAX_ADDITIONAL_CHANGES_LENGTH = 500;

export type ProductCustomization = { ringSize?: string; stoneColor?: string; additionalChanges?: string };
export type ValidatedEnquirySelection = { selectionId: string; quantity: number; customization?: ProductCustomization };

const optionalLimitedText = (value: unknown, maximum: number) => {
  const text = String(value || "").trim();
  return text.length <= maximum ? text : null;
};

export const validateEnquirySelections = (value: unknown) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ENQUIRY_ITEMS) {
    return { error: `Select between 1 and ${MAX_ENQUIRY_ITEMS} products`, selections: [] as ValidatedEnquirySelection[] };
  }

  const selections: ValidatedEnquirySelection[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return { error: "Invalid product selection", selections: [] as ValidatedEnquirySelection[] };
    }
    const candidate = entry as Record<string, unknown>;
    const selectionId = String(candidate.selectionId || "").trim();
    const quantity = Number(candidate.quantity);
    if (!/^[A-Za-z0-9_-]{43}$/.test(selectionId) || seen.has(selectionId)) {
      return { error: "Invalid product selection", selections: [] as ValidatedEnquirySelection[] };
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ENQUIRY_QUANTITY) {
      return { error: `Quantity must be a whole number from 1 to ${MAX_ENQUIRY_QUANTITY}`, selections: [] as ValidatedEnquirySelection[] };
    }
    const rawCustomization = candidate.customization && typeof candidate.customization === "object"
      ? candidate.customization as Record<string, unknown>
      : {};
    const ringSize = optionalLimitedText(rawCustomization.ringSize, MAX_RING_SIZE_LENGTH);
    const stoneColor = optionalLimitedText(rawCustomization.stoneColor, MAX_STONE_COLOR_LENGTH);
    const additionalChanges = optionalLimitedText(rawCustomization.additionalChanges, MAX_ADDITIONAL_CHANGES_LENGTH);
    if (ringSize === null || stoneColor === null || additionalChanges === null) {
      return { error: "One or more customization details are too long", selections: [] as ValidatedEnquirySelection[] };
    }
    const customization = {
      ...(ringSize ? { ringSize } : {}),
      ...(stoneColor ? { stoneColor } : {}),
      ...(additionalChanges ? { additionalChanges } : {}),
    };
    seen.add(selectionId);
    selections.push({ selectionId, quantity, ...(Object.keys(customization).length ? { customization } : {}) });
  }
  return { error: null, selections };
};

export const validateCustomerDetails = (value: unknown) => {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const name = String(candidate.name || "").trim();
  const mobile = String(candidate.mobile || "").trim();
  const remarks = String(candidate.remarks || "").trim();
  if (!name) return { error: "Customer name is required", customer: null };
  if (name.length > MAX_CUSTOMER_NAME_LENGTH) return { error: "Customer name is too long", customer: null };
  if (mobile.length > MAX_MOBILE_LENGTH) return { error: "Mobile number is too long", customer: null };
  if (remarks.length > MAX_REMARKS_LENGTH) return { error: "Remarks are too long", customer: null };
  if (mobile && !/^[+()\-\s0-9]{6,30}$/.test(mobile)) {
    return { error: "Enter a valid mobile or WhatsApp number", customer: null };
  }
  return { error: null, customer: { name, ...(mobile ? { mobile } : {}), ...(remarks ? { remarks } : {}) } };
};

export const numericCatalogueValue = (value: unknown) => {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

export const calculatePermittedTotals = (
  entries: Array<{ price?: unknown; usd?: unknown; quantity: number }>,
  visibleFields: { price: boolean; usd: boolean }
) => {
  let tagPrice = 0;
  let usd = 0;
  entries.forEach((entry) => {
    if (visibleFields.price) {
      const value = numericCatalogueValue(entry.price);
      if (value !== null) tagPrice += value * entry.quantity;
    }
    if (visibleFields.usd) {
      const value = numericCatalogueValue(entry.usd);
      if (value !== null) usd += value * entry.quantity;
    }
  });
  return {
    ...(visibleFields.price ? { tagPrice: Math.round(tagPrice * 100) / 100 } : {}),
    ...(visibleFields.usd ? { usd: Math.round(usd * 100) / 100 } : {}),
  };
};
