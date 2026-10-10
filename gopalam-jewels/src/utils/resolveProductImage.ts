import { normalizeStoredImageUrl } from "@/utils/normalizeStoredImageUrl";
import { getRemovedImageCandidates } from "@/utils/productImageRemoval";

type ProductLike = {
  barcode?: string | number;
  image?: string;
  r2Image?: string;
  imageUrl?: string;
  previewUrl?: string;
  fallbackImageUrl?: string;
  resolvedImageUrl?: string;
  imageCatalogueImage?: string;
  imageCatalogueR2Image?: string;
  imageCatalogueResolvedImageUrl?: string;
  imageCatalogueFallbackImageUrl?: string;
  imageRemoved?: boolean;
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
  normalizeStoredImageUrl(product.resolvedImageUrl) ||
  normalizeStoredImageUrl(product.image) ||
  normalizeStoredImageUrl(product.r2Image);

const getBarcodeFallbackImage = (product: ProductLike, primaryUrl: string) =>
  [
    product.fallbackImageUrl,
    product.resolvedImageUrl,
    product.image,
    product.r2Image,
  ]
    .map(normalizeStoredImageUrl)
    .find((url) => url && url !== primaryUrl) || "";

const getBarcodeStoragePair = (product: ProductLike) => ({
  image: normalizeStoredImageUrl(product.image),
  r2Image: normalizeStoredImageUrl(product.r2Image),
});

const getCatalogueImage = (product: ProductLike) =>
  normalizeStoredImageUrl(product.imageCatalogueResolvedImageUrl) ||
  normalizeStoredImageUrl(product.imageCatalogueImage) ||
  normalizeStoredImageUrl(product.imageCatalogueR2Image);

const getCatalogueFallbackImage = (product: ProductLike, primaryUrl: string) =>
  [
    product.imageCatalogueFallbackImageUrl,
    product.imageCatalogueImage,
    product.imageCatalogueR2Image,
  ]
    .map(normalizeStoredImageUrl)
    .find((url) => url && url !== primaryUrl) || "";

const getCatalogueStoragePair = (product: ProductLike) => ({
  image: normalizeStoredImageUrl(product.imageCatalogueImage),
  r2Image: normalizeStoredImageUrl(product.imageCatalogueR2Image),
});

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

export const resolveProductImageCandidates = (
  product: ProductLike | null | undefined,
  products: ProductLike[]
) => {
  if (!product) return { primaryUrl: "", fallbackUrl: "", image: "", r2Image: "" };

  // A user explicitly removed this barcode's image. Do not resurrect a shared
  // Item No image through the normal fallback chain.
  const removedImageCandidates = getRemovedImageCandidates(product.imageRemoved);
  if (removedImageCandidates) return removedImageCandidates;

  const barcode = getBarcode(product);
  const itemNo = getItemNo(product);
  const directBarcodeImage = getBarcodeImage(product);

  if (directBarcodeImage) return {
    primaryUrl: directBarcodeImage,
    fallbackUrl: getBarcodeFallbackImage(product, directBarcodeImage),
    ...getBarcodeStoragePair(product),
  };

  const productIndex = getProductImageIndex(products);

  const barcodeMatch = barcode
    ? productIndex.byBarcode.get(barcode)
    : undefined;

  const barcodeImage = barcodeMatch ? getBarcodeImage(barcodeMatch) : "";

  if (barcodeImage && barcodeMatch) return {
    primaryUrl: barcodeImage,
    fallbackUrl: getBarcodeFallbackImage(barcodeMatch, barcodeImage),
    ...getBarcodeStoragePair(barcodeMatch),
  };

  if (!itemNo) return { primaryUrl: "", fallbackUrl: "", image: "", r2Image: "" };

  const itemMatches = productIndex.byItemNo.get(itemNo) || [];

  const itemBarcodeMatch = itemMatches.find((candidate) => getBarcodeImage(candidate));
  const itemBarcodeImage = itemBarcodeMatch ? getBarcodeImage(itemBarcodeMatch) : "";

  if (itemBarcodeImage && itemBarcodeMatch) return {
    primaryUrl: itemBarcodeImage,
    fallbackUrl: getBarcodeFallbackImage(itemBarcodeMatch, itemBarcodeImage),
    ...getBarcodeStoragePair(itemBarcodeMatch),
  };

  const catalogueProduct = getCatalogueImage(product)
    ? product
    : itemMatches.find((candidate) => getCatalogueImage(candidate));
  const catalogueImage = catalogueProduct ? getCatalogueImage(catalogueProduct) : "";
  return {
    primaryUrl: catalogueImage,
    fallbackUrl: catalogueProduct
      ? getCatalogueFallbackImage(catalogueProduct, catalogueImage)
      : "",
    ...(catalogueProduct
      ? getCatalogueStoragePair(catalogueProduct)
      : { image: "", r2Image: "" }),
  };
};

export const resolveProductImage = (
  product: ProductLike | null | undefined,
  products: ProductLike[]
) => resolveProductImageCandidates(product, products).primaryUrl;
