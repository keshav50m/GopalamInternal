import clientPromise from "@/lib/mongodb";

let productIndexesPromise: Promise<unknown> | null = null;

export const ensureProductIndexes = () => {
  if (!productIndexesPromise) {
    productIndexesPromise = clientPromise.then(async (client) => {
      const db = client.db("gopalamJewels");

      await Promise.all([
        db.collection("savedProducts").createIndex(
          { barcode: 1 },
          { name: "barcode_search" }
        ),
        db.collection("savedProducts").createIndex(
          { "data.ITEMNO": 1 },
          { name: "item_no_search" }
        ),
        db.collection("imageCatalogue").createIndex(
          { itemNo: 1 },
          { name: "image_catalogue_item_no_lookup" }
        ),
      ]);
    });
  }

  return productIndexesPromise;
};
