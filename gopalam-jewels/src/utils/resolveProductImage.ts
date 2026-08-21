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

export const resolveProductImage = (
  product: ProductLike | null | undefined,
  products: ProductLike[]
) => {
  if (!product) return "";

  const barcode = getBarcode(product);
  const itemNo = getItemNo(product);

  const barcodeMatch = barcode
    ? products.find((candidate) => getBarcode(candidate) === barcode)
    : undefined;

  const barcodeImage =
    getBarcodeImage(product) ||
    (barcodeMatch ? getBarcodeImage(barcodeMatch) : "");

  if (barcodeImage) return barcodeImage;

  if (!itemNo) return "";

  const itemMatches = products.filter(
    (candidate) => getItemNo(candidate) === itemNo
  );

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
