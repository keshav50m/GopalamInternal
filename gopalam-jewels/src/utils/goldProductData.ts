export const GOLD_PRODUCT_FIELDS = [
  "BARCODE",
  "LOT NO",
  "KARAT1",
  "STONE NAME",
  "NW",
  "GW",
  "ST WT.",
  "DI WT.",
  "TOTAL TAG",
  "US$",
] as const;

export type GoldProductData = Record<(typeof GOLD_PRODUCT_FIELDS)[number], string>;

const text = (value: unknown) => String(value ?? "").trim();

export const normalizeGoldLotNo = (value: unknown) =>
  text(value).toUpperCase();

export const parseGoldQRCode = (value: string): GoldProductData => {
  const parts = value.split(",");

  return Object.fromEntries(
    GOLD_PRODUCT_FIELDS.map((field, index) => [field, text(parts[index])])
  ) as GoldProductData;
};

export const normalizeGoldProductData = (
  value: Record<string, unknown> | null | undefined
): GoldProductData =>
  Object.fromEntries(
    GOLD_PRODUCT_FIELDS.map((field) => [field, text(value?.[field])])
  ) as GoldProductData;

export const isCompleteGoldQR = (value: string) =>
  value.split(",").length >= GOLD_PRODUCT_FIELDS.length;

