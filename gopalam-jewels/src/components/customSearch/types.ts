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
  usdMin: string;
  usdMax: string;
};

export type SearchProduct = {
  _id: string;
  barcode?: string | number;
  image?: string;
  imageCatalogueImage?: string;
  data?: {
    BARCODE?: string;
    ITEMNO?: string;
    "STONE NAME"?: string;
    "GROSS WT"?: string | number;
    "STONE WT"?: string | number;
    "DAI WT"?: string | number;
    "TAG PRICE"?: string | number;
    USD?: string | number;
    SIZE?: string;
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
  usdMin: "",
  usdMax: "",
};
