export const QR_PRODUCT_FIELDS = [
  "ITEMNO",
  "STONE NAME",
  "GROSS WT",
  "STONE WT",
  "DAI WT",
  "TAG PRICE",
  "SIZE",
  "USD",
] as const;

export const QR_NUMERIC_FIELDS = new Set<string>([
  "GROSS WT",
  "STONE WT",
  "DAI WT",
  "TAG PRICE",
  "USD",
]);

export type QRProductData = {
  BARCODE: string;
  ITEMNO: string;
  "STONE NAME": string;
  "GROSS WT": string;
  "STONE WT": string;
  "DAI WT": string;
  "TAG PRICE": string;
  SIZE: string;
  USD: string;
};

export const parseQRCode = (fullString: string): QRProductData => {
  const parts = fullString.split(",").map((part) => part.trim());

  return {
    BARCODE: parts[0] || "",
    ITEMNO: parts[1] || "",
    "STONE NAME": parts[2] || "",
    "GROSS WT": parts[3] || "",
    "STONE WT": parts[4] || "",
    "DAI WT": parts[5] || "",
    "TAG PRICE": parts[6] || "",
    SIZE: parts[7] || "",
    USD: parts[8] || "",
  };
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
