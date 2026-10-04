import { normalizeStoredImageUrl } from "@/utils/normalizeStoredImageUrl";

type ProductLike = {
  barcode?: string | number;
  image?: string;
  r2Image?: string;
  data?: {
    ITEMNO?: string | number;
  } | null;
};

type CatalogueImageLike = {
  itemNo?: string | number;
  image?: string;
  r2Image?: string;
};

type StoredImagePair = { image: string; r2Image: string };

export const normalizeBarcode = (value: unknown) =>
  String(value || "").trim();

export const normalizeItemNo = (value: unknown) =>
  String(value || "").trim().toUpperCase();

export const buildProductsByItemNo = (products: ProductLike[]) => {
  const productsByItemNo = new Map<string, ProductLike[]>();

  products.forEach((product) => {
    const itemNo = normalizeItemNo(product.data?.ITEMNO);
    if (!itemNo) return;

    const itemProducts = productsByItemNo.get(itemNo) || [];
    itemProducts.push(product);
    productsByItemNo.set(itemNo, itemProducts);
  });

  return productsByItemNo;
};

export const buildCatalogueImageMap = (catalogueImages: CatalogueImageLike[]) =>
  new Map(
    catalogueImages.map((item) => [
      normalizeItemNo(item.itemNo),
      {
        image: normalizeStoredImageUrl(item.image),
        r2Image: normalizeStoredImageUrl(item.r2Image),
      },
    ])
  );

const getStoredImagePair = (product?: ProductLike): StoredImagePair => ({
  image: normalizeStoredImageUrl(product?.image),
  r2Image: normalizeStoredImageUrl(product?.r2Image),
});

const hasStoredImagePair = (pair: StoredImagePair) => Boolean(pair.image || pair.r2Image);

export const resolveImageCatalogueExcelImage = ({
  itemNo,
  selectedProduct,
  catalogueImageMap,
  productsByItemNo,
}: {
  itemNo: unknown;
  selectedProduct?: ProductLike;
  catalogueImageMap: Map<string, StoredImagePair>;
  productsByItemNo: Map<string, ProductLike[]>;
}) => {
  const normalizedItemNo = normalizeItemNo(itemNo);
  if (!normalizedItemNo) return { image: "", r2Image: "" };

  const catalogueImage = catalogueImageMap.get(normalizedItemNo);
  if (catalogueImage && hasStoredImagePair(catalogueImage)) return catalogueImage;

  const selectedProductImage = getStoredImagePair(selectedProduct);
  if (hasStoredImagePair(selectedProductImage)) return selectedProductImage;

  return (
    productsByItemNo
      .get(normalizedItemNo)
      ?.map(getStoredImagePair)
      .find(hasStoredImagePair) || { image: "", r2Image: "" }
  );
};
