import type { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import type { CastingCatalogueFieldSettings } from "@/lib/castingCatalogue";

export type CastingSharedCatalogueDocument = {
  _id?: ObjectId;
  token: string;
  productBarcodes: string[];
  visibleFields: CastingCatalogueFieldSettings;
  title?: string;
  createdAt: Date;
  createdBy: ObjectId;
  active: boolean;
};

let indexPromise: Promise<unknown> | null = null;

export const getCastingSharedCataloguesCollection = async () => {
  const client = await clientPromise;
  return client
    .db("gopalamJewels")
    .collection<CastingSharedCatalogueDocument>("castingSharedCatalogues");
};

export const ensureCastingSharedCatalogueIndexes = () => {
  if (!indexPromise) {
    indexPromise = getCastingSharedCataloguesCollection().then((collection) =>
      Promise.all([
        collection.createIndex({ token: 1 }, { unique: true, name: "catalogue_token_unique" }),
        collection.createIndex({ createdAt: -1 }, { name: "catalogue_created_at" }),
      ])
    );
  }
  return indexPromise;
};
