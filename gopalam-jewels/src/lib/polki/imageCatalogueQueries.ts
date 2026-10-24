import type { Collection, Document } from "mongodb";
export const findCatalogueImagesByItemNos = async (collection: Collection<Document>, values: unknown[]) => {
  const itemNos = [...new Set(values.map(value => String(value ?? "").trim().toUpperCase()).filter(Boolean))];
  if (!itemNos.length) return [];
  if (itemNos.length > 1000) throw new Error("At most 1000 item numbers per lookup");
  return collection.find({itemNo: {$in: itemNos}}).project({itemNo:1,image:1,r2Image:1}).limit(1000).toArray();
};
