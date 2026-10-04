import clientPromise from "@/lib/mongodb";

let goldIndexesPromise: Promise<unknown> | null = null;

export const ensureGoldProductIndexes = () => {
  if (!goldIndexesPromise) {
    goldIndexesPromise = clientPromise.then(async (client) => {
      const db = client.db("gopalamJewels");

      await Promise.all([
        db.collection("savedProducts_Gold").createIndex(
          { barcode: 1 },
          { name: "gold_barcode_search" }
        ),
        db.collection("savedProducts_Gold").createIndex(
          { "data.LOT NO": 1 },
          { name: "gold_lot_no_search" }
        ),
        db.collection("savedProducts_Gold").createIndex(
          { sold: 1 },
          { name: "gold_sold_status_search" }
        ),
        db.collection("ImageCatalogue_Gold").createIndex(
          { "LOT NO": 1 },
          { name: "gold_catalogue_lot_no_lookup" }
        ),
      ]);
    });
  }

  return goldIndexesPromise;
};

