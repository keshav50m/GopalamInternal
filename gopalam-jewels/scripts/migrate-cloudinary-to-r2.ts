import { readFile, writeFile } from "node:fs/promises";

const REPORT_DIR = "reports";
const dryRun = String(process.env.MIGRATION_DRY_RUN || "true").toLowerCase() === "true";
if (!dryRun) {
  throw new Error("Safety stop: this script currently supports MIGRATION_DRY_RUN=true only. No migration was executed.");
}

const safetyGate = JSON.parse(await readFile(`${REPORT_DIR}/pre-migration-safety-gate.json`, "utf8"));
const destinationPreflight = JSON.parse(await readFile(`${REPORT_DIR}/r2-destination-preflight.json`, "utf8"));
if (destinationPreflight.summary.existingObjectsRequiringIdentityVerification || destinationPreflight.summary.unknown) {
  throw new Error("Safety stop: one or more proposed R2 destinations are occupied or unknown. Dry-run plan was not regenerated.");
}
const safeEntries = safetyGate.entryValidations.filter((entry: { classification: string }) => entry.classification === "SAFE_TO_MIGRATE");
const actions = safeEntries.map((entry: any) => {
  const references = [
    ...entry.savedProductReferences.map((reference: any) => ({ collection: "savedProducts", ...reference })),
    ...entry.imageCatalogueReferences.map((reference: any) => ({ collection: "imageCatalogue", ...reference })),
  ];
  return {
    mode: "DRY_RUN",
    action: "WOULD_COPY_ONCE_THEN_VERIFY_BEFORE_ANY_DATABASE_SWITCH",
    publicId: entry.publicId,
    source: entry.preferredSourceUrl,
    sourceSha256: entry.sourceValidation.sha256,
    sourceBytes: entry.sourceValidation.bytesRead,
    r2DestinationKey: entry.proposedR2ObjectKey,
    proposedR2Url: entry.proposedR2Url,
    wouldOverwriteWithoutIdentityVerification: false,
    affectedReferences: references.map((reference: any) => ({
      collection: reference.collection,
      documentId: reference._id,
      barcode: reference.barcode,
      itemNo: reference.itemNo,
      oldUrl: reference.imageUrl,
      proposedNewUrl: entry.proposedR2Url,
    })),
  };
});

const rollbackMap = actions.flatMap((action: any) => action.affectedReferences.map((reference: any) => ({
  collection: reference.collection,
  documentId: reference.documentId,
  barcode: reference.barcode,
  itemNo: reference.itemNo,
  originalCloudinaryUrl: reference.oldUrl,
  proposedR2Url: reference.proposedNewUrl,
  publicId: action.publicId,
})));

const summary = {
  generatedAt: new Date().toISOString(),
  mode: "DRY_RUN",
  assetsThatWouldBeCopiedOnce: actions.length,
  databaseReferencesThatWouldEventuallySwitchAfterCopyVerification: rollbackMap.length,
  excludedForManualReview: safetyGate.entryValidations.length - actions.length,
  destinationPreflight: destinationPreflight.summary,
  objectKeyStrategy: "migrated/<percent-encoded Cloudinary public ID>.<Cloudinary format>; public ID, not Item No or barcode, is the stable identity",
  futureRequiredOrder: ["download Cloudinary original", "verify source", "upload copy without overwrite", "verify R2 HTTP/content-type/bytes/checksum", "mark copied", "switch MongoDB only after all required assets pass"],
  safety: { mongoDbWrites: 0, cloudinaryWritesOrDeletes: 0, r2Writes: 0 },
};

await writeFile(`${REPORT_DIR}/r2-migration-dry-run.json`, `${JSON.stringify({ summary, actions }, null, 2)}\n`, "utf8");
await writeFile(`${REPORT_DIR}/r2-migration-rollback-map.json`, `${JSON.stringify(rollbackMap, null, 2)}\n`, "utf8");
await writeFile(`${REPORT_DIR}/r2-migration-dry-run-summary.txt`, [
  "Cloudinary to R2 migration DRY RUN",
  `Generated: ${summary.generatedAt}`,
  `Assets that would be copied once: ${summary.assetsThatWouldBeCopiedOnce}`,
  `References that would eventually switch: ${summary.databaseReferencesThatWouldEventuallySwitchAfterCopyVerification}`,
  `Assets excluded for manual review: ${summary.excludedForManualReview}`,
  "",
  `Object key strategy: ${summary.objectKeyStrategy}`,
  "No MongoDB, Cloudinary, or R2 data was modified.",
].join("\n") + "\n", "utf8");
console.log(JSON.stringify(summary, null, 2));
