export type ProductData = {
  BARCODE?: string;
  ITEM?: string;
  "LOT NO."?: string;
  "GROSSWT."?: string;
  "NET WT."?: string;
  "PUWAI"?: string;
  "FINAL"?: string;
  TAG?: string;
  SILVER?: string;
};

export type SavedProduct = {
  _id?: string;
  barcode?: string | number;
  image?: string;
  r2Image?: string;
  resolvedImageUrl?: string;
  fallbackImageUrl?: string;
  imageRemoved?: boolean;
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

export type DashboardData = {
  stats: DashboardStats;
  stoneDistribution: ChartPoint[];
  uploadTrend: ChartPoint[];
  missingImages: SavedProduct[];
  recentUploads: SavedProduct[];
};

export type ChartPoint = {
  label: string;
  value: number;
};
