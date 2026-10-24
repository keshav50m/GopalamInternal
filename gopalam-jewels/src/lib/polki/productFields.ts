// Persist search values once, so reads never convert or normalize entire collections.
export const normalizePolkiText = (value: unknown) => String(value ?? "").trim().toUpperCase();
export const polkiSearchFields = (barcode: unknown, data: Record<string, unknown>) => {
  const numeric = (key: string) => {
    const text = String(data[key] ?? "").trim();
    const value = Number(text);
    return text && Number.isFinite(value) ? value : null;
  };
  const suffixes = (value: unknown) => {
    const text = normalizePolkiText(value);
    return Array.from({length:text.length}, (_, index) => text.slice(index));
  };
  return {
    searchText: {barcode:suffixes(barcode),itemNo:suffixes(data.ITEM),stone:suffixes(data["LOT NO."]),size:suffixes(data.TAG)},
    barcode: String(barcode ?? "").trim(), itemNo: normalizePolkiText(data.ITEM),
    search: {
      barcode: normalizePolkiText(barcode), itemNo: normalizePolkiText(data.ITEM),
      stone: normalizePolkiText(data["LOT NO."]), size: normalizePolkiText(data.TAG),
      gross: numeric("GROSSWT."), stoneWt: numeric("NET WT."), dai: numeric("PUWAI"),
      price: numeric("FINAL"), usd: numeric("SILVER"),
      labour: numeric("LABOUR PER GRM"), labourPuwai: numeric("LABOUR + PUWAI"),
    },
  };
};
export const polkiHasImage = (...values: unknown[]) => values.some(value => /^https?:\/\//i.test(String(value ?? "").trim()));
