export const POLKI_FIELDS = ["BARCODE", "ITEM", "LOT NO.", "PUWAI", "NET WT.", "GROSSWT.", "TAG", "LABOUR PER GRM", "LABOUR + PUWAI", "SILVER", "FINAL"] as const;
export const QR_PRODUCT_FIELDS = POLKI_FIELDS.slice(1);
export const QR_NUMERIC_FIELDS = new Set<string>(["PUWAI", "NET WT.", "GROSSWT.", "LABOUR PER GRM", "LABOUR + PUWAI", "SILVER", "FINAL"]);
export type QRProductData = Record<(typeof POLKI_FIELDS)[number], string>;
export const parseQRCode = (value: string): QRProductData => {
  const parts = value.split(",").map(part => part.trim());
  return Object.fromEntries(POLKI_FIELDS.map((field, index) => [field, parts[index] || ""])) as QRProductData;
};

const normalizeText = (value: unknown) =>
  String(value ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase();

const normalizeNumeric = (value: unknown) => {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text) return "";
  const number = Number(text);
  return Number.isFinite(number) ? String(number) : normalizeText(value);
};

export const areQRFieldValuesEqual = (
  field: (typeof QR_PRODUCT_FIELDS)[number],
  currentValue: unknown,
  newValue: unknown
) =>
  QR_NUMERIC_FIELDS.has(field)
    ? normalizeNumeric(currentValue) === normalizeNumeric(newValue)
    : normalizeText(currentValue) === normalizeText(newValue);

export const getChangedQRFields = (
  currentData: Record<string, unknown> | null | undefined,
  newData: QRProductData
) =>
  QR_PRODUCT_FIELDS.filter(
    (field) => !areQRFieldValuesEqual(field, currentData?.[field], newData[field])
  );
