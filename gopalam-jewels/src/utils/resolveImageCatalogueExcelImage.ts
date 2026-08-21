import { normalizeStoredImageUrl } from "@/utils/normalizeStoredImageUrl";

type ProductLike = {
  barcode?: string | number;
  image?: string;
  data?: {
    ITEMNO?: string | number;
  } | null;
};

type CatalogueImageLike = {
  itemNo?: string | number;
  image?: string;
};

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
      normalizeStoredImageUrl(item.image),
    ])
  );

export const resolveImageCatalogueExcelImage = ({
  itemNo,
  selectedProduct,
  catalogueImageMap,
  productsByItemNo,
}: {
  itemNo: unknown;
  selectedProduct?: ProductLike;
  catalogueImageMap: Map<string, string>;
  productsByItemNo: Map<string, ProductLike[]>;
}) => {
  const normalizedItemNo = normalizeItemNo(itemNo);
  if (!normalizedItemNo) return "";

  const catalogueImage = catalogueImageMap.get(normalizedItemNo);
  if (catalogueImage) return catalogueImage;

  const selectedProductImage = normalizeStoredImageUrl(selectedProduct?.image);
  if (selectedProductImage) return selectedProductImage;

  return (
    productsByItemNo
      .get(normalizedItemNo)
      ?.map((product) => normalizeStoredImageUrl(product.image))
      .find(Boolean) || ""
  );
};
