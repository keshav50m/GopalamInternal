import { normalizeStoredImageUrl } from "@/utils/normalizeStoredImageUrl";

type ProductLike = {
  barcode?: string | number;
  image?: string;
  imageUrl?: string;
  previewUrl?: string;
  imageCatalogueImage?: string;
  data?: {
    BARCODE?: string | number;
    ITEMNO?: string | number;
  } | null;
};

const normalize = (value: unknown) => String(value || "").trim();

const getBarcode = (product: ProductLike) =>
  normalize(product.barcode || product.data?.BARCODE);

const getItemNo = (product: ProductLike) => normalize(product.data?.ITEMNO);

const getBarcodeImage = (product: ProductLike) =>
  normalizeStoredImageUrl(product.imageUrl) ||
  normalizeStoredImageUrl(product.previewUrl) ||
  normalizeStoredImageUrl(product.image);

const getCatalogueImage = (product: ProductLike) =>
  normalizeStoredImageUrl(product.imageCatalogueImage);

type ProductImageIndex = {
  byBarcode: Map<string, ProductLike>;
  byItemNo: Map<string, ProductLike[]>;
};

const productImageIndexes = new WeakMap<ProductLike[], ProductImageIndex>();

const getProductImageIndex = (products: ProductLike[]) => {
  const cached = productImageIndexes.get(products);
  if (cached) return cached;

  const index: ProductImageIndex = {
    byBarcode: new Map(),
    byItemNo: new Map(),
  };

  products.forEach((candidate) => {
    const barcode = getBarcode(candidate);
    if (barcode && !index.byBarcode.has(barcode)) {
      index.byBarcode.set(barcode, candidate);
    }

    const itemNo = getItemNo(candidate);
    if (!itemNo) return;
    const itemProducts = index.byItemNo.get(itemNo) || [];
    itemProducts.push(candidate);
    index.byItemNo.set(itemNo, itemProducts);
  });

  productImageIndexes.set(products, index);
  return index;
};

export const resolveProductImage = (
  product: ProductLike | null | undefined,
  products: ProductLike[]
) => {
  if (!product) return "";

  const barcode = getBarcode(product);
  const itemNo = getItemNo(product);
  const directBarcodeImage = getBarcodeImage(product);

  if (directBarcodeImage) return directBarcodeImage;

  const productIndex = getProductImageIndex(products);

  const barcodeMatch = barcode
    ? productIndex.byBarcode.get(barcode)
    : undefined;

  const barcodeImage = barcodeMatch ? getBarcodeImage(barcodeMatch) : "";

  if (barcodeImage) return barcodeImage;

  if (!itemNo) return "";

  const itemMatches = productIndex.byItemNo.get(itemNo) || [];

  const itemBarcodeImage = itemMatches
    .map(getBarcodeImage)
    .find(Boolean);

  if (itemBarcodeImage) return itemBarcodeImage;

  return (
    getCatalogueImage(product) ||
    itemMatches.map(getCatalogueImage).find(Boolean) ||
    ""
  );
};
