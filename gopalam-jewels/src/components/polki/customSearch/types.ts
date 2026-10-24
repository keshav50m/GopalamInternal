export type SearchFiltersState = {
  barcode: string;
  itemNo: string;
  stone: string;
  size: string;
  grossMin: string;
  grossMax: string;
  stoneWtMin: string;
  stoneWtMax: string;
  daiMin: string;
  daiMax: string;
  priceMin: string;
  priceMax: string;
  labourMin: string;
  labourMax: string;
  labourPuwaiMin: string;
  labourPuwaiMax: string;
  usdMin: string;
  usdMax: string;
};

export type SearchProduct = {
  _id: string;
  barcode?: string | number;
  image?: string;
  r2Image?: string;
  resolvedImageUrl?: string;
  fallbackImageUrl?: string;
  imageCatalogueImage?: string;
  imageCatalogueR2Image?: string;
  imageCatalogueResolvedImageUrl?: string;
  imageCatalogueFallbackImageUrl?: string;
  imageRemoved?: boolean;
  data?: {
    BARCODE?: string;
    ITEM?: string;
    "LOT NO."?: string;
    "GROSSWT."?: string | number;
    "NET WT."?: string | number;
    "PUWAI"?: string | number;
    "FINAL"?: string | number;
    "LABOUR PER GRM"?: string | number;
    "LABOUR + PUWAI"?: string | number;
    SILVER?: string | number;
    TAG?: string;
  };
};

export const initialSearchFilters: SearchFiltersState = {
  barcode: "",
  itemNo: "",
  stone: "",
  size: "",
  grossMin: "",
  grossMax: "",
  stoneWtMin: "",
  stoneWtMax: "",
  daiMin: "",
  daiMax: "",
  priceMin: "",
  priceMax: "",
  labourMin: "",
  labourMax: "",
  labourPuwaiMin: "",
  labourPuwaiMax: "",
  usdMin: "",
  usdMax: "",
};
