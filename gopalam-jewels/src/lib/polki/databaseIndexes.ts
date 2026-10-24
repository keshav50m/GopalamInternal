import clientPromise from "@/lib/mongodb";
import { polkiProductIndexes } from "@/lib/polki/indexDefinitions";
let indexPromise: Promise<unknown> | null = null;
export const ensureProductIndexes = () => {
  if (!indexPromise) indexPromise = clientPromise.then(async client => {
    const db=client.db("gopalamJewels");
    await Promise.all([
      db.collection("polkiProducts").createIndexes(polkiProductIndexes),
      db.collection("polkiImageCatalogue").createIndex({itemNo:1},{unique:true}),
    ]);
  }).catch(error => {indexPromise=null;throw error;});
  return indexPromise;
};
