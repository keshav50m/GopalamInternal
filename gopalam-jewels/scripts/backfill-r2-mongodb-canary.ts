import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { BSON, MongoClient, type Document } from "mongodb";

type CollectionName = "savedProducts" | "imageCatalogue";
type MappingReference = {
  collection: CollectionName;
  documentId: string;
  field: "image";
  imageUrl: string;
  r2Image: string;
  barcode: string;
  itemNo: string;
  publicId: string;
};
type MappingAsset = {
  publicId: string;
  cloudinarySourceUrls: string[];
  preferredCloudinarySourceUrl: string;
  r2ObjectKey: string;
  r2PublicUrl: string;
  sourceByteSize: number;
  sourceSha256: string;
  sourceContentType: string;
  verificationOrigin: string;
  databaseReferenceCount: number;
  references: MappingReference[];
  barcodes: string[];
  itemNos: string[];
};
type Classification =
  | "ELIGIBLE_FOR_BACKFILL"
  | "ALREADY_CORRECT"
  | "STALE_MAPPING"
  | "MISSING_DOCUMENT"
  | "NON_CLOUDINARY_CURRENT_IMAGE"
  | "UNVERIFIED_R2"
  | "AMBIGUOUS_MAPPING";
type PrecheckReference = MappingReference & {
  expectedR2Url: string;
  expectedR2ObjectKey: string;
  currentImageUrl: string;
  currentR2Image: string;
  currentR2ImageFieldExists: boolean;
  currentBarcode: string;
  currentItemNo: string;
  classification: Classification;
  reason: string;
};

const DATABASE_NAME = clean(process.env.MONGO_DB_NAME) || "gopalamJewels";
const MAPPING_PATH = "reports/r2-consolidated-cloudinary-r2-mapping.json";
const PRECHECK_PATH = "reports/r2-mongodb-backfill-precheck.json";
const CANARY_PATH = "reports/r2-mongodb-canary-backfill.json";
const SUMMARY_PATH = "reports/r2-mongodb-canary-backfill-summary.txt";
const ROLLBACK_PATH = "reports/r2-mongodb-canary-rollback.json";
const BACKUP_ROOT = "migration-backups";
const CANARY_SIZE = 10;
const R2_CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;
const IMAGE_FORMATS = new Set(["avif", "bmp", "gif", "heic", "heif", "ico", "j2k", "jp2", "jpeg", "jpg", "jxl", "png", "psd", "svg", "tga", "tif", "tiff", "webp"]);

function clean(value: unknown) { return String(value ?? "").trim(); }
const unique = <T>(values: T[]) => [...new Set(values)];
const timestampForPath = () => new Date().toISOString().replace(/[:.]/g, "-");
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256Bytes = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.replace(/https?:\/\/\S+/g, "[redacted-url]").slice(0, 1000);
};
const required = (name: string) => {
  const value = clean(process.env[name]);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};
const writeJsonAtomic = async (path: string, value: unknown) => {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
};
const sha256File = async (path: string) => {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => hash.update(chunk));
  await once(stream, "end");
  return hash.digest("hex");
};
const mapWithConcurrency = async <T, R>(values: T[], concurrency: number, task: (value: T, index: number) => Promise<R>) => {
  const output = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      output[index] = await task(values[index], index);
    }
  }));
  return output;
};

const safeDecode = (value: string) => { try { return decodeURIComponent(value); } catch { return null; } };
const looksLikeTransformation = (segment: string) => {
  if (/^s--[^/]+--$/.test(segment) || /^t_[^/]+$/.test(segment) || /^(?:if_|if_else$|if_end$)/.test(segment)) return true;
  return segment.split(",").every((part) => /^(?:a|ac|af|ar|b|bo|br|c|co|cs|d|dl|dn|dpr|du|e|eo|f|fl|fn|fps|g|h|ki|l|o|p|pg|q|r|so|sp|t|u|vc|vs|w|x|y|z)_.+/.test(part));
};
const parseCloudinaryUrl = (input: unknown) => {
  let url: URL;
  try { url = new URL(clean(input)); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.hostname.toLowerCase() !== "res.cloudinary.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4) return null;
  const delivery = parts.slice(3);
  const versionIndex = delivery.findIndex((segment) => /^v\d+$/.test(segment));
  let asset = versionIndex >= 0 ? delivery.slice(versionIndex + 1) : [...delivery];
  if (versionIndex < 0) while (asset.length > 1 && looksLikeTransformation(asset[0])) asset = asset.slice(1);
  const decoded = asset.map(safeDecode);
  if (!decoded.length || decoded.some((part) => !part)) return null;
  const publicParts = decoded as string[];
  const last = publicParts.at(-1)!;
  const extension = last.match(/\.([A-Za-z0-9]+)$/)?.[1].toLowerCase() || "";
  if (IMAGE_FORMATS.has(extension)) publicParts[publicParts.length - 1] = last.slice(0, -(extension.length + 1));
  const publicId = publicParts.join("/");
  return publicId && !publicParts.some((part) => part === "." || part === "..") ? { publicId } : null;
};
const objectKeyFromR2Url = (input: unknown, baseUrl: string) => {
  try {
    const url = new URL(clean(input));
    const base = new URL(baseUrl);
    if (url.hostname.toLowerCase() !== base.hostname.toLowerCase()) return null;
    const basePath = base.pathname.replace(/\/+$/, "");
    if (basePath && !url.pathname.startsWith(`${basePath}/`)) return null;
    const parts = url.pathname.slice(basePath.length).replace(/^\/+/, "").split("/").filter(Boolean).map(safeDecode);
    return parts.length && !parts.some((part) => !part || part === "." || part === "..") ? (parts as string[]).join("/") : null;
  } catch { return null; }
};
const documentBarcode = (document: Document) => clean(document.barcode ?? document.data?.BARCODE);
const documentItemNo = (document: Document) => clean(document.itemNo ?? document.data?.ITEMNO);
const reportDocument = (document: Document) => JSON.parse(BSON.EJSON.stringify(document, { relaxed: false }));
const withoutR2Image = (document: Document) => {
  const clone = BSON.EJSON.parse(BSON.EJSON.stringify(document, { relaxed: false }));
  delete clone.r2Image;
  return clone;
};

const backupCollection = async (collection: ReturnType<ReturnType<MongoClient["db"]>["collection"]>, directory: string) => {
  const filename = `${collection.collectionName}.canonical-ejson.ndjson`;
  const path = `${directory}/${filename}`;
  const stream = createWriteStream(path, { encoding: "utf8", flags: "wx" });
  const documents = new Map<string, Document>();
  let documentCount = 0;
  for await (const document of collection.find({}).sort({ _id: 1 })) {
    if (!stream.write(`${BSON.EJSON.stringify(document, { relaxed: false })}\n`)) await once(stream, "drain");
    documents.set(clean(document._id), document);
    documentCount += 1;
  }
  stream.end();
  await once(stream, "finish");
  const file = await stat(path);
  return { manifest: { collection: collection.collectionName, documentCount, backupFilename: filename, bytes: file.size, sha256: await sha256File(path) }, documents };
};

const selectCanary = (eligible: PrecheckReference[], assetsByPublicId: Map<string, MappingAsset>) => {
  const selected: PrecheckReference[] = [];
  const usedDocuments = new Set<string>();
  const usedItemNos = new Set<string>();
  const usedBarcodes = new Set<string>();
  const usedPublicIds = new Set<string>();
  const add = (reference?: PrecheckReference) => {
    if (!reference) return false;
    const identity = `${reference.collection}|${reference.documentId}`;
    if (usedDocuments.has(identity)) return false;
    selected.push(reference);
    usedDocuments.add(identity);
    if (reference.itemNo) usedItemNos.add(reference.itemNo.toUpperCase());
    if (reference.barcode) usedBarcodes.add(reference.barcode);
    usedPublicIds.add(reference.publicId);
    return true;
  };
  const sharedSaved = eligible.find((reference) => reference.collection === "savedProducts" && (assetsByPublicId.get(reference.publicId)?.databaseReferenceCount || 0) > 1);
  add(sharedSaved);
  const fill = (collection: CollectionName, target: number, strict: boolean) => {
    for (const reference of eligible) {
      if (selected.filter((entry) => entry.collection === collection).length >= target) break;
      if (reference.collection !== collection) continue;
      if (strict && ((reference.itemNo && usedItemNos.has(reference.itemNo.toUpperCase())) || (reference.barcode && usedBarcodes.has(reference.barcode)) || usedPublicIds.has(reference.publicId))) continue;
      add(reference);
    }
  };
  fill("savedProducts", 5, true);
  fill("savedProducts", 5, false);
  fill("imageCatalogue", 5, true);
  fill("imageCatalogue", 5, false);
  if (selected.length !== CANARY_SIZE || selected.filter((entry) => entry.collection === "savedProducts").length !== 5 || selected.filter((entry) => entry.collection === "imageCatalogue").length !== 5) {
    throw new Error("Safety stop: could not select exactly five safe records from each affected collection.");
  }
  return selected;
};

const main = async () => {
  if (!process.argv.includes("--execute-canary")) throw new Error("Safety stop: the explicit --execute-canary flag is required.");
  for (const path of [PRECHECK_PATH, CANARY_PATH, SUMMARY_PATH, ROLLBACK_PATH]) {
    try { await stat(path); throw new Error(`Safety stop: ${path} already exists; refusing to overwrite a prior canary artifact.`); }
    catch (error: any) { if (error?.code !== "ENOENT") throw error; }
  }
  const mapping = JSON.parse(await readFile(MAPPING_PATH, "utf8"));
  const assets = mapping.assets as MappingAsset[];
  const references = assets.flatMap((asset) => asset.references.map((reference) => ({ ...reference, publicId: asset.publicId })));
  if (references.length !== Number(mapping.summary.currentCloudinaryReferences)) throw new Error("Safety stop: consolidated mapping reference count is inconsistent.");
  const assetsByPublicId = new Map(assets.map((asset) => [asset.publicId, asset]));
  const documentIdentityCounts = new Map<string, number>();
  const objectKeyOwners = new Map<string, Set<string>>();
  for (const reference of references) {
    const identity = `${reference.collection}|${reference.documentId}`;
    documentIdentityCounts.set(identity, (documentIdentityCounts.get(identity) || 0) + 1);
  }
  for (const asset of assets) objectKeyOwners.set(asset.r2ObjectKey, new Set([...(objectKeyOwners.get(asset.r2ObjectKey) || []), asset.publicId]));

  const mongoUri = required("MONGO_URI");
  const publicBaseUrl = required("R2_PUBLIC_BASE_URL");
  const bucketName = required("R2_BUCKET_NAME");
  const r2 = new S3Client({
    region: "auto", endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") },
    maxAttempts: 1,
    requestHandler: new NodeHttpHandler({ connectionTimeout: 10_000, requestTimeout: 120_000, socketTimeout: 120_000, throwOnRequestTimeout: true }),
  });
  const headObject = async (key: string) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try { return await r2.send(new HeadObjectCommand({ Bucket: bucketName, Key: key })); }
      catch (error) { lastError = error; if (attempt < MAX_ATTEMPTS) await delay(attempt * 2_000); }
    }
    throw lastError;
  };

  const backupDirectory = `${BACKUP_ROOT}/r2-backfill-${timestampForPath()}`;
  await mkdir(backupDirectory, { recursive: true });
  const client = new MongoClient(mongoUri, { readPreference: "primary" });
  await client.connect();
  try {
    const db = client.db(DATABASE_NAME);
    const liveCollections = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name));
    const affectedCollections = unique(references.map((reference) => reference.collection)).sort() as CollectionName[];
    if (affectedCollections.some((collection) => !liveCollections.has(collection))) throw new Error("Safety stop: an affected collection from the mapping does not exist in the live database.");

    const backupStartedAt = new Date().toISOString();
    const backupResults = [];
    const documentsByCollection = new Map<CollectionName, Map<string, Document>>();
    for (const collectionName of affectedCollections) {
      const result = await backupCollection(db.collection(collectionName), backupDirectory);
      backupResults.push(result.manifest);
      documentsByCollection.set(collectionName, result.documents);
    }
    const backupManifest = {
      createdAt: new Date().toISOString(), backupStartedAt, database: DATABASE_NAME,
      format: "MongoDB canonical Extended JSON, one complete untransformed original document per line",
      transformed: false, collections: backupResults,
      safety: { mongoDbWrites: 0, mongoDbDeletes: 0, cloudinaryWritesOrDeletes: 0, r2WritesOrDeletes: 0 },
    };
    await writeJsonAtomic(`${backupDirectory}/backup-manifest.json`, backupManifest);
    console.log(`Backup complete: ${backupDirectory}`);

    let verifiedAssets = 0;
    const r2ValidationList = await mapWithConcurrency(assets, R2_CONCURRENCY, async (asset) => {
      const base = { publicId: asset.publicId, r2ObjectKey: asset.r2ObjectKey, verified: false, reason: "" };
      if (!asset.verificationOrigin || !/^[a-f0-9]{64}$/i.test(asset.sourceSha256) || asset.sourceByteSize <= 0 || !asset.sourceContentType.startsWith("image/")) return { ...base, reason: "Consolidated mapping lacks prior verification evidence." };
      if (objectKeyOwners.get(asset.r2ObjectKey)?.size !== 1) return { ...base, reason: "R2 object key maps to multiple Cloudinary public IDs." };
      if (objectKeyFromR2Url(asset.r2PublicUrl, publicBaseUrl) !== asset.r2ObjectKey) return { ...base, reason: "R2 URL does not resolve to the mapped object key." };
      try {
        const head = await headObject(asset.r2ObjectKey);
        const contentType = clean(head.ContentType).split(";")[0].toLowerCase();
        if (Number(head.ContentLength || 0) !== asset.sourceByteSize) return { ...base, reason: "Live R2 byte size differs from the verified mapping." };
        if (contentType !== asset.sourceContentType) return { ...base, reason: "Live R2 Content-Type differs from the verified mapping." };
        verifiedAssets += 1;
        if (verifiedAssets % 500 === 0) console.log(`R2 precheck: ${verifiedAssets}/${assets.length}`);
        return { ...base, verified: true };
      } catch (error) { return { ...base, reason: safeError(error) }; }
    });
    const r2Validation = new Map(r2ValidationList.map((entry) => [entry.publicId, entry]));

    const precheckReferences: PrecheckReference[] = references.map((reference) => {
      const asset = assetsByPublicId.get(reference.publicId)!;
      const document = documentsByCollection.get(reference.collection)?.get(reference.documentId);
      const base = {
        ...reference, expectedR2Url: asset.r2PublicUrl, expectedR2ObjectKey: asset.r2ObjectKey,
        currentImageUrl: clean(document?.image), currentR2Image: clean(document?.r2Image),
        currentR2ImageFieldExists: Boolean(document && Object.prototype.hasOwnProperty.call(document, "r2Image")),
        currentBarcode: document ? documentBarcode(document) : "", currentItemNo: document ? documentItemNo(document) : "",
      };
      if ((documentIdentityCounts.get(`${reference.collection}|${reference.documentId}`) || 0) !== 1 || reference.publicId !== parseCloudinaryUrl(reference.imageUrl)?.publicId) return { ...base, classification: "AMBIGUOUS_MAPPING", reason: "Document identity is duplicated or reference public ID is inconsistent." };
      if (!document) return { ...base, classification: "MISSING_DOCUMENT", reason: "Mapped MongoDB document no longer exists." };
      const currentParsed = parseCloudinaryUrl(document.image);
      if (!currentParsed) return { ...base, classification: "NON_CLOUDINARY_CURRENT_IMAGE", reason: "Current image is empty, temporary/blob, R2, malformed, or otherwise non-Cloudinary." };
      if (clean(document.image) !== reference.imageUrl || currentParsed.publicId !== reference.publicId) return { ...base, classification: "STALE_MAPPING", reason: "Current image URL/identity changed since the consolidated mapping was generated." };
      if (!r2Validation.get(reference.publicId)?.verified) return { ...base, classification: "UNVERIFIED_R2", reason: r2Validation.get(reference.publicId)?.reason || "R2 counterpart could not be proven." };
      if (clean(document.r2Image)) {
        if (objectKeyFromR2Url(document.r2Image, publicBaseUrl) === asset.r2ObjectKey) return { ...base, classification: "ALREADY_CORRECT", reason: "Existing r2Image resolves to the verified R2 object." };
        return { ...base, classification: "AMBIGUOUS_MAPPING", reason: "Existing non-empty r2Image points to a different R2 object." };
      }
      return { ...base, classification: "ELIGIBLE_FOR_BACKFILL", reason: "Live document and verified R2 counterpart match the consolidated mapping." };
    });

    let temporaryBlobReferences = 0;
    for (const documents of documentsByCollection.values()) for (const document of documents.values()) if (clean(document.image).startsWith("blob:")) temporaryBlobReferences += 1;
    const classificationCount = (classification: Classification) => precheckReferences.filter((reference) => reference.classification === classification).length;
    const precheckSummary = {
      generatedAt: new Date().toISOString(), mode: "READ_ONLY_PRE_WRITE_VALIDATION", backupDirectory,
      totalMappedReferences: precheckReferences.length,
      eligibleForBackfill: classificationCount("ELIGIBLE_FOR_BACKFILL"),
      alreadyCorrect: classificationCount("ALREADY_CORRECT"), staleMappings: classificationCount("STALE_MAPPING"),
      missingDocuments: classificationCount("MISSING_DOCUMENT"), nonCloudinaryCurrentImages: classificationCount("NON_CLOUDINARY_CURRENT_IMAGE"),
      unverifiedR2Mappings: classificationCount("UNVERIFIED_R2"), ambiguousMappings: classificationCount("AMBIGUOUS_MAPPING"),
      temporaryBlobReferences, verifiedUniqueR2Assets: r2ValidationList.filter((entry) => entry.verified).length,
      safety: { mongoDbWritesAtPrecheck: 0, mongoDbDeletes: 0, cloudinaryWritesOrDeletes: 0, r2WritesOrDeletes: 0 },
    };
    await writeJsonAtomic(PRECHECK_PATH, { summary: precheckSummary, r2ValidationFailures: r2ValidationList.filter((entry) => !entry.verified), references: precheckReferences });
    console.log(`Precheck: eligible=${precheckSummary.eligibleForBackfill}, already=${precheckSummary.alreadyCorrect}, stale=${precheckSummary.staleMappings}, missing=${precheckSummary.missingDocuments}, nonCloudinary=${precheckSummary.nonCloudinaryCurrentImages}, unverifiedR2=${precheckSummary.unverifiedR2Mappings}, ambiguous=${precheckSummary.ambiguousMappings}, blob=${precheckSummary.temporaryBlobReferences}`);
    if (precheckSummary.ambiguousMappings > 0 || precheckSummary.unverifiedR2Mappings > 0) throw new Error("Safety stop: ambiguous or unverified mappings exist; no MongoDB canary writes were performed.");
    if (precheckSummary.eligibleForBackfill < CANARY_SIZE) throw new Error("Safety stop: fewer than 10 references are safely eligible.");

    const selected = selectCanary(precheckReferences.filter((reference) => reference.classification === "ELIGIBLE_FOR_BACKFILL"), assetsByPublicId);
    const rollbackEntries = selected.map((reference) => {
      const document = documentsByCollection.get(reference.collection)!.get(reference.documentId)!;
      return {
        collection: reference.collection, _id: reference.documentId, originalImage: clean(document.image),
        originalR2ImageFieldExisted: Object.prototype.hasOwnProperty.call(document, "r2Image"),
        originalR2Image: Object.prototype.hasOwnProperty.call(document, "r2Image") ? document.r2Image : null,
        newR2Image: reference.expectedR2Url, barcode: documentBarcode(document), itemNo: documentItemNo(document),
      };
    });
    await writeJsonAtomic(ROLLBACK_PATH, { generatedAt: new Date().toISOString(), mode: "ROLLBACK_INFORMATION_ONLY_NOT_EXECUTED", backupDirectory, entries: rollbackEntries });

    const attempts: any[] = [];
    for (const reference of selected) {
      const original = documentsByCollection.get(reference.collection)!.get(reference.documentId)!;
      const filter: Record<string, unknown> = { _id: original._id, image: reference.imageUrl };
      if (Object.prototype.hasOwnProperty.call(original, "r2Image")) filter.r2Image = original.r2Image;
      else filter.r2Image = { $exists: false };
      const result = await db.collection(reference.collection).updateOne(filter, { $set: { r2Image: reference.expectedR2Url } });
      attempts.push({ collection: reference.collection, documentId: reference.documentId, publicId: reference.publicId, expectedImage: reference.imageUrl, expectedR2Image: reference.expectedR2Url, matchedCount: result.matchedCount, modifiedCount: result.modifiedCount, guardPassed: result.matchedCount === 1 && result.modifiedCount === 1, before: reportDocument(original) });
      await writeJsonAtomic(CANARY_PATH, { generatedAt: new Date().toISOString(), mode: "TEN_RECORD_CANARY_IN_PROGRESS", selected, attempts, safety: { maximumMongoDbWrites: CANARY_SIZE, cloudinaryWritesOrDeletes: 0, r2WritesOrDeletes: 0 } });
    }

    const verificationResults = [];
    for (const attempt of attempts) {
      const before = documentsByCollection.get(attempt.collection as CollectionName)!.get(attempt.documentId)!;
      const after = await db.collection(attempt.collection).findOne({ _id: before._id });
      let r2Verified = false;
      let r2Error = "";
      if (after && attempt.guardPassed) {
        try {
          const asset = assetsByPublicId.get(attempt.publicId)!;
          const response = await r2.send(new GetObjectCommand({ Bucket: bucketName, Key: asset.r2ObjectKey }));
          if (!response.Body) throw new Error("R2 GetObject returned an empty body.");
          const body = await response.Body.transformToByteArray();
          const contentType = clean(response.ContentType).split(";")[0].toLowerCase();
          const publicResponse = await fetch(asset.r2PublicUrl, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(60_000), cache: "no-store" });
          r2Verified = body.byteLength === asset.sourceByteSize && sha256Bytes(body) === asset.sourceSha256 && contentType === asset.sourceContentType && publicResponse.ok && clean(publicResponse.headers.get("content-type")).toLowerCase().startsWith("image/");
          if (!r2Verified) r2Error = "R2 byte/hash/Content-Type/public verification failed.";
        } catch (error) { r2Error = safeError(error); }
      }
      const imageUnchanged = Boolean(after && clean(after.image) === clean(before.image));
      const barcodeUnchanged = Boolean(after && documentBarcode(after) === documentBarcode(before));
      const itemNoUnchanged = Boolean(after && documentItemNo(after) === documentItemNo(before));
      const otherBusinessDataUnchanged = Boolean(after && isDeepStrictEqual(withoutR2Image(after), withoutR2Image(before)));
      const storedR2Correctly = Boolean(after && clean(after.r2Image) === attempt.expectedR2Image);
      verificationResults.push({
        collection: attempt.collection, documentId: attempt.documentId, publicId: attempt.publicId,
        guardPassed: attempt.guardPassed, imageUnchanged, barcodeUnchanged, itemNoUnchanged, otherBusinessDataUnchanged,
        storedR2Correctly, r2Verified, r2Error, before: reportDocument(before), after: after ? reportDocument(after) : null,
        verified: attempt.guardPassed && imageUnchanged && barcodeUnchanged && itemNoUnchanged && otherBusinessDataUnchanged && storedR2Correctly && r2Verified,
      });
    }

    const canarySummary = {
      generatedAt: new Date().toISOString(), mode: "TEN_RECORD_GUARDED_CANARY_ONLY", selected: selected.length,
      updateAttempts: attempts.length, successfullyUpdated: attempts.filter((attempt) => attempt.guardPassed).length,
      guardFailures: attempts.filter((attempt) => !attempt.guardPassed).length,
      postWriteVerified: verificationResults.filter((result) => result.verified).length,
      failed: verificationResults.filter((result) => !result.verified).length,
      incorrectMappings: verificationResults.filter((result) => result.guardPassed && (!result.storedR2Correctly || !result.r2Verified)).length,
      dataIntegrity: {
        imageFieldsChanged: verificationResults.filter((result) => !result.imageUnchanged).length,
        barcodeChanges: verificationResults.filter((result) => !result.barcodeUnchanged).length,
        itemNoChanges: verificationResults.filter((result) => !result.itemNoUnchanged).length,
        otherBusinessDataChanges: verificationResults.filter((result) => !result.otherBusinessDataUnchanged).length,
        r2ImageChanges: verificationResults.filter((result) => result.guardPassed && result.storedR2Correctly).length,
      },
      storage: { cloudinaryWrites: 0, cloudinaryDeletes: 0, r2Writes: 0, r2Deletes: 0 },
      database: { mongoDbWrites: attempts.filter((attempt) => attempt.guardPassed).length, mongoDbDeletes: 0 },
      backupDirectory, rollbackPath: ROLLBACK_PATH,
    };
    await writeJsonAtomic(CANARY_PATH, { summary: canarySummary, precheckSummary, selected, attempts, verificationResults });
    await writeFile(SUMMARY_PATH, [
      "R2 MONGODB BACKFILL CANARY SUMMARY", "", "PRECHECK",
      `Total mapped references: ${precheckSummary.totalMappedReferences}`, `Eligible: ${precheckSummary.eligibleForBackfill}`,
      `Already correct: ${precheckSummary.alreadyCorrect}`, `Stale mappings: ${precheckSummary.staleMappings}`,
      `Missing documents: ${precheckSummary.missingDocuments}`, `Non-Cloudinary: ${precheckSummary.nonCloudinaryCurrentImages}`,
      `Unverified R2: ${precheckSummary.unverifiedR2Mappings}`, `Ambiguous: ${precheckSummary.ambiguousMappings}`,
      `Temporary/blob: ${precheckSummary.temporaryBlobReferences}`, "", "CANARY",
      `Selected: ${canarySummary.selected}`, `Update attempts: ${canarySummary.updateAttempts}`,
      `Successfully updated: ${canarySummary.successfullyUpdated}`, `Guard failures: ${canarySummary.guardFailures}`,
      `Post-write verified: ${canarySummary.postWriteVerified}`, `Failed: ${canarySummary.failed}`,
      `Incorrect mappings: ${canarySummary.incorrectMappings}`, "", "DATA INTEGRITY",
      `image fields changed: ${canarySummary.dataIntegrity.imageFieldsChanged}`,
      `barcode changes: ${canarySummary.dataIntegrity.barcodeChanges}`,
      `Item No changes: ${canarySummary.dataIntegrity.itemNoChanges}`,
      `other business-data changes: ${canarySummary.dataIntegrity.otherBusinessDataChanges}`,
      `r2Image changes: ${canarySummary.dataIntegrity.r2ImageChanges}`, "", "STORAGE",
      `Cloudinary writes/deletes: ${canarySummary.storage.cloudinaryWrites + canarySummary.storage.cloudinaryDeletes}`,
      `R2 writes/deletes: ${canarySummary.storage.r2Writes + canarySummary.storage.r2Deletes}`,
      `MongoDB writes: ${canarySummary.database.mongoDbWrites}`, `MongoDB deletes: ${canarySummary.database.mongoDbDeletes}`,
      `Backup: ${backupDirectory}`, `Rollback file: ${ROLLBACK_PATH}`, "",
      "The existing image fields remain Cloudinary URLs.", "The remaining MongoDB backfill was NOT performed.",
    ].join("\n") + "\n", "utf8");
    console.log(await readFile(SUMMARY_PATH, "utf8"));
    if (canarySummary.successfullyUpdated !== CANARY_SIZE || canarySummary.postWriteVerified !== CANARY_SIZE || canarySummary.failed || canarySummary.incorrectMappings || Object.values(canarySummary.dataIntegrity).slice(0, 4).some((value) => value !== 0)) process.exitCode = 1;
  } finally { await client.close(); }
};

await main();
