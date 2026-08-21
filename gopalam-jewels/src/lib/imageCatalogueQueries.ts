import type { Collection, Document } from "mongodb";

const normalizeItemNo = (value: unknown) =>
  String(value ?? "").trim().toUpperCase();

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const findCatalogueImagesByItemNos = async (
  collection: Collection<Document>,
  values: unknown[]
) => {
  const itemNos = Array.from(
    new Set(values.map(normalizeItemNo).filter(Boolean))
  );
  if (itemNos.length === 0) return [];

  const exactMatches = await collection
    .find({ itemNo: { $in: itemNos } })
    .project({ itemNo: 1, image: 1 })
    .toArray();
  const matchedItemNos = new Set(
    exactMatches.map((item) => normalizeItemNo(item.itemNo))
  );
  const unmatchedItemNos = itemNos.filter(
    (itemNo) => !matchedItemNos.has(itemNo)
  );

  if (unmatchedItemNos.length === 0) return exactMatches;

  const compatibilityMatches = await collection
    .find({
      $or: unmatchedItemNos.map((itemNo) => ({
        itemNo: {
          $regex: `^\\s*${escapeRegex(itemNo)}\\s*$`,
          $options: "i",
        },
      })),
    })
    .project({ itemNo: 1, image: 1 })
    .toArray();

  return [...exactMatches, ...compatibilityMatches];
};
