export type ProductData = {
  BARCODE?: string;
  ITEMNO?: string;
  "STONE NAME"?: string;
  "GROSS WT"?: string;
  "STONE WT"?: string;
  "DAI WT"?: string;
  "TAG PRICE"?: string;
  SIZE?: string;
  USD?: string;
};

export type SavedProduct = {
  _id?: string;
  barcode?: string | number;
  image?: string;
  data?: ProductData;
  updatedAt?: string;
};

export type DashboardStats = {
  totalProducts: number;
  productsWithImages: number;
  productsMissingImages: number;
  todaysUploads: number;
  uploadsThisMonth: number;
};

export type ChartPoint = {
  label: string;
  value: number;
};
