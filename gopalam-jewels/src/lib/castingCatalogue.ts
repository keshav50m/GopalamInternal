import type { Document } from "mongodb";

export const CASTING_CATALOGUE_FIELDS = [
  "image",
  "barcode",
  "item",
  "stone",
  "gross",
  "stoneWt",
  "dai",
  "price",
  "usd",
  "size",
] as const;

export type CastingCatalogueField = (typeof CASTING_CATALOGUE_FIELDS)[number];
export type CastingCatalogueFieldSettings = Record<CastingCatalogueField, boolean>;

export const CASTING_CATALOGUE_FIELD_LABELS: Record<CastingCatalogueField, string> = {
  image: "Image",
  barcode: "Barcode",
  item: "Item No.",
  stone: "Stone Name",
  gross: "Gross Wt.",
  stoneWt: "Stone Wt.",
  dai: "Diamond Wt.",
  price: "Tag Price",
  usd: "USD",
  size: "Size",
};

export const DEFAULT_CASTING_CATALOGUE_FIELDS: CastingCatalogueFieldSettings =
  Object.fromEntries(CASTING_CATALOGUE_FIELDS.map((field) => [field, true])) as CastingCatalogueFieldSettings;

export const normalizeCatalogueFields = (value: unknown): CastingCatalogueFieldSettings => {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(
    CASTING_CATALOGUE_FIELDS.map((field) => [field, candidate[field] === true])
  ) as CastingCatalogueFieldSettings;
};

export const escapeCatalogueSearch = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const catalogueProductValues = (product: Document) => ({
  barcode: String(product.barcode ?? "").trim(),
  item: String(product.data?.ITEMNO ?? "").trim(),
  stone: String(product.data?.["STONE NAME"] ?? "").trim(),
  gross: String(product.data?.["GROSS WT"] ?? "").trim(),
  stoneWt: String(product.data?.["STONE WT"] ?? "").trim(),
  dai: String(product.data?.["DAI WT"] ?? "").trim(),
  price: String(product.data?.["TAG PRICE"] ?? "").trim(),
  usd: String(product.data?.USD ?? "").trim(),
  size: String(product.data?.SIZE ?? "").trim(),
});

export const normalizeCatalogueDiscounts = (value: unknown) => {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const normalize = (input: unknown) => {
    const number = Number(input);
    return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 0;
  };
  return { pricePercent: normalize(candidate.pricePercent), usdPercent: normalize(candidate.usdPercent) };
};

export const applyCatalogueDiscounts = <T extends ReturnType<typeof catalogueProductValues>>(
  values: T,
  discounts?: { pricePercent?: number; usdPercent?: number }
) => {
  const discounted = { ...values };
  const apply = (raw: string, percent = 0) => {
    const number = Number(raw.replace(/,/g, "").trim());
    return raw && Number.isFinite(number) && percent > 0
      ? String(Math.round(number * (1 - percent / 100) * 100) / 100)
      : raw;
  };
  discounted.price = apply(values.price, discounts?.pricePercent);
  discounted.usd = apply(values.usd, discounts?.usdPercent);
  return discounted;
};
