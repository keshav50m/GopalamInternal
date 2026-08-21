import type { ChartPoint, DashboardStats, SavedProduct } from "./types";
import { normalizeStoredImageUrl } from "@/utils/normalizeStoredImageUrl";

export const getBarcode = (product: SavedProduct) =>
  String(product.barcode || product.data?.BARCODE || "").trim();

export const hasImage = (product: SavedProduct) =>
  Boolean(normalizeStoredImageUrl(product.image));

export const getStoneName = (product: SavedProduct) =>
  String(product.data?.["STONE NAME"] || "Unknown").trim() || "Unknown";

export const getUpdatedDate = (product: SavedProduct) => {
  if (!product.updatedAt) return null;

  const date = new Date(product.updatedAt);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDisplayDate = (product: SavedProduct) => {
  const date = getUpdatedDate(product);
  if (!date) return "Not available";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

export const formatDateKey = (date: Date) => date.toISOString().slice(0, 10);

export const isSameDay = (date: Date, reference: Date) =>
  date.getFullYear() === reference.getFullYear() &&
  date.getMonth() === reference.getMonth() &&
  date.getDate() === reference.getDate();

export const isSameMonth = (date: Date, reference: Date) =>
  date.getFullYear() === reference.getFullYear() &&
  date.getMonth() === reference.getMonth();

export const buildStats = (products: SavedProduct[]): DashboardStats => {
  const now = new Date();
  const productsWithImages = products.filter(hasImage).length;
  const datedProducts = products
    .map(getUpdatedDate)
    .filter((date): date is Date => Boolean(date));

  return {
    totalProducts: products.length,
    productsWithImages,
    productsMissingImages: products.length - productsWithImages,
    todaysUploads: datedProducts.filter((date) => isSameDay(date, now)).length,
    uploadsThisMonth: datedProducts.filter((date) => isSameMonth(date, now)).length,
  };
};

export const buildStoneDistribution = (products: SavedProduct[]): ChartPoint[] => {
  const counts = new Map<string, number>();

  products.forEach((product) => {
    const stoneName = getStoneName(product);
    counts.set(stoneName, (counts.get(stoneName) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, 10);
};

export const buildUploadTrend = (products: SavedProduct[]): ChartPoint[] => {
  const counts = new Map<string, number>();

  products.forEach((product) => {
    const date = getUpdatedDate(product);
    if (!date) return;

    const key = formatDateKey(date);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([label, value]) => ({ label, value }));
};

export const sortByRecentUpload = (products: SavedProduct[]) =>
  [...products].sort((a, b) => {
    const dateA = getUpdatedDate(a)?.getTime() || 0;
    const dateB = getUpdatedDate(b)?.getTime() || 0;
    return dateB - dateA;
  });
