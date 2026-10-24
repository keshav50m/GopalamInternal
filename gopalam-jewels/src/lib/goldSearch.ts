import type { Document } from "mongodb";

export const goldTextFilters = [
  ["barcode", "Barcode (exact)"], ["lotNo", "Lot No (starts with)"],
  ["karat", "Karat (exact, e.g. 14 K)"], ["stone", "Stone (starts with)"],
] as const;
export const goldRangeFilters = [
  ["nw", "NW", "Net Weight"], ["gw", "GW", "Gross Weight"],
  ["stoneWt", "ST WT.", "Stone Weight"], ["diamondWt", "DI WT.", "Diamond Weight"],
  ["totalTag", "TOTAL TAG", "Total Tag"], ["usd", "US$", "US$"],
] as const;

export class GoldSearchValidationError extends Error {}
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseGoldSearch(params: URLSearchParams) {
  const clauses: Document[] = [];
  for (const [key] of goldTextFilters) {
    const value = params.get(key)?.trim() || "";
    if (value.length > 100) throw new GoldSearchValidationError(`${key} must be 100 characters or fewer`);
    if (!value) continue;
    if (key === "barcode") {
      const values: (string | number)[] = [value];
      if (/^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value))) values.push(Number(value));
      clauses.push({ $or: [{ barcode: { $in: values } }, { "data.BARCODE": { $in: values } }] });
    } else {
      const field = { lotNo: "LOT NO", karat: "KARAT1", stone: "STONE NAME" }[key];
      clauses.push({ [`data.${field}`]: { $regex: `^${escapeRegex(value)}${key === "karat" ? "$" : ""}`, $options: "i" } });
    }
  }
  for (const [key, field, label] of goldRangeFilters) {
    const read = (suffix: string) => {
      const raw = params.get(`${key}${suffix}`)?.trim();
      if (!raw) return null;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) throw new GoldSearchValidationError(`${label} requires a non-negative number`);
      return value;
    };
    const min = read("Min"), max = read("Max");
    if (min === null && max === null) continue;
    if (min !== null && max !== null && min > max) throw new GoldSearchValidationError(`${label}: minimum must not exceed maximum`);
    // getField is required for literal Gold field names containing periods.
    const number = { $convert: { input: { $trim: { input: { $replaceAll: {
      input: { $convert: { input: { $getField: { field: { $literal: field }, input: "$data" } }, to: "string", onError: "", onNull: "" } },
      find: ",", replacement: "",
    } } } }, to: "double", onError: null, onNull: null } };
    const comparisons: Document[] = [{ $ne: [number, null] }];
    if (min !== null) comparisons.push({ $gte: [number, min] });
    if (max !== null) comparisons.push({ $lte: [number, max] });
    clauses.push({ $expr: { $and: comparisons } });
  }
  const status = params.get("status") || "all";
  if (!["all", "available", "sold"].includes(status)) throw new GoldSearchValidationError("Invalid inventory status");
  if (status === "sold") clauses.push({ sold: true });
  if (status === "available") clauses.push({ sold: { $ne: true } });
  const pageSize = Number(params.get("pageSize") ?? 25);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new GoldSearchValidationError("Page size must be between 1 and 100");
  const cursor = params.get("cursor") || "";
  if (cursor && !/^[a-f\d]{24}$/i.test(cursor)) throw new GoldSearchValidationError("Invalid page cursor");
  return { clauses, pageSize, cursor };
}
