export type PreparedGoldProduct = {
  barcode: string;
  data: Record<string, string>;
  image: string;
  r2Image: string;
  hasR2Image: boolean;
};

export const buildGoldProductUpdate = (
  item: PreparedGoldProduct,
  updatedAt: Date
) => {
  const fieldsToSet: Record<string, unknown> = {
    barcode: item.barcode,
    data: item.data,
    updatedAt,
  };
  if (item.image) fieldsToSet.image = item.image;
  if (item.hasR2Image && item.r2Image) fieldsToSet.r2Image = item.r2Image;

  const hasReplacementImage = Boolean(item.image || item.r2Image);
  return {
    $set: fieldsToSet,
    ...(hasReplacementImage ? { $unset: { imageRemoved: "" } } : {}),
    $setOnInsert: { sold: false, createdAt: updatedAt },
  };
};

export const buildGoldCatalogueUpdate = (
  item: PreparedGoldProduct,
  lotNo: string,
  updatedAt: Date
) => {
  const fieldsToSet: Record<string, unknown> = {
    "LOT NO": lotNo,
    updatedAt,
  };
  if (item.image) fieldsToSet.image = item.image;
  if (item.r2Image) fieldsToSet.r2Image = item.r2Image;
  return { $set: fieldsToSet };
};
