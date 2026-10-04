import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { BSON, MongoClient, ObjectId, type Document } from "mongodb";

type CollectionName = "savedProducts" | "imageCatalogue";
type Reference = {
  collection: CollectionName;
  documentId: string;
  field: "image";
  imageUrl: string;
  r2Image: string;
  barcode: string;
  itemNo: string;
  publicId: string;
};
type Asset = {
  publicId: string;
  r2ObjectKey: string;
  r2PublicUrl: string;
  sourceByteSize: number;
  sourceSha256: string;
  sourceContentType: string;
  verificationOrigin: string;
  references: Reference[];
};
type EligibleReference = Reference & {
  expectedR2Url: string;
  originalR2ImageFieldExisted: boolean;
  originalR2Image: unknown;
  originalBarcode: string;
  originalItemNo: string;
};
type ResultStatus = "UPDATED_VERIFIED" | "ALREADY_CORRECT_CONCURRENT" | "GUARD_FAILURE" | "FAILED";
type BatchResult = {
  identity: string;
  collection: CollectionName;
  documentId: string;
  publicId: string;
  expectedImage: string;
  expectedR2Image: string;
  status: ResultStatus;
  matchedCount: number;
  modifiedCount: number;
  imageUnchanged: boolean;
  barcodeUnchanged: boolean;
  itemNoUnchanged: boolean;
  otherBusinessDataUnchanged: boolean;
  r2ImageCorrect: boolean;
  error: string;
  verifiedAt: string;
};

const REPORT_DIR = "reports";
const BACKUP_ROOT = "migration-backups";
const MAPPING_PATH = `${REPORT_DIR}/r2-consolidated-cloudinary-r2-mapping.json`;
const REPORT_PATH = `${REPORT_DIR}/r2-mongodb-full-backfill.json`;
const SUMMARY_PATH = `${REPORT_DIR}/r2-mongodb-full-backfill-summary.txt`;
const CHECKPOINT_PATH = `${REPORT_DIR}/r2-mongodb-full-backfill-checkpoint.json`;
const ROLLBACK_PATH = `${REPORT_DIR}/r2-mongodb-full-backfill-rollback.json`;
const RECONCILIATION_PATH = `${REPORT_DIR}/r2-mongodb-post-backfill-reconciliation.json`;
const DATABASE_NAME = clean(process.env.MONGO_DB_NAME) || "gopalamJewels";
const BATCH_SIZE = 200;
const DB_CONCURRENCY = 4;
const R2_CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;
const IMAGE_FORMATS = new Set(["avif", "bmp", "gif", "heic", "heif", "ico", "j2k", "jp2", "jpeg", "jpg", "jxl", "png", "psd", "svg", "tga", "tif", "tiff", "webp"]);

function clean(value: unknown) { return String(value ?? "").trim(); }
const unique = <T>(values: T[]) => [...new Set(values)];
const identityFor = (reference: Pick<Reference, "collection" | "documentId">) => `${reference.collection}|${reference.documentId}`;
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const timestampForPath = () => new Date().toISOString().replace(/[:.]/g, "-");
const hashText = (value: string) => createHash("sha256").update(value).digest("hex");
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

const main = async () => {
  if (!process.argv.includes("--execute-full-backfill")) throw new Error("Safety stop: explicit --execute-full-backfill authorization flag is required.");
  const mappingText = await readFile(MAPPING_PATH, "utf8");
  const mappingHash = hashText(mappingText);
  const mapping = JSON.parse(mappingText);
  const assets = mapping.assets as Asset[];
  const references = assets.flatMap((asset) => asset.references.map((reference) => ({ ...reference, publicId: asset.publicId })));
  if (references.length !== Number(mapping.summary.currentCloudinaryReferences)) throw new Error("Safety stop: consolidated mapping count is inconsistent.");
  if (new Set(references.map(identityFor)).size !== references.length) throw new Error("Safety stop: duplicate mapped document identities exist.");
  if (new Set(assets.map((asset) => asset.publicId)).size !== assets.length || new Set(assets.map((asset) => asset.r2ObjectKey)).size !== assets.length) throw new Error("Safety stop: asset identity or R2 key collision exists.");
  const assetByPublicId = new Map(assets.map((asset) => [asset.publicId, asset]));
  const referenceByIdentity = new Map(references.map((reference) => [identityFor(reference), reference]));

  let checkpoint: any = null;
  try { checkpoint = JSON.parse(await readFile(CHECKPOINT_PATH, "utf8")); } catch {}
  if (checkpoint && checkpoint.mappingSha256 !== mappingHash) throw new Error("Safety stop: checkpoint belongs to a different consolidated mapping.");
  if (!checkpoint) {
    for (const path of [REPORT_PATH, SUMMARY_PATH, ROLLBACK_PATH, RECONCILIATION_PATH]) {
      try { await stat(path); throw new Error(`Safety stop: ${path} already exists; refusing to overwrite a previous full-backfill artifact.`); }
      catch (error: any) { if (error?.code !== "ENOENT") throw error; }
    }
  }

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

  const client = new MongoClient(mongoUri, { readPreference: "primary" });
  await client.connect();
  try {
    const db = client.db(DATABASE_NAME);
    let preWriteSummary = checkpoint?.preWriteSummary;
    let backupDirectory = clean(checkpoint?.backupDirectory);
    let eligible = (checkpoint?.eligible || []) as EligibleReference[];
    let rollback = checkpoint ? JSON.parse(await readFile(ROLLBACK_PATH, "utf8")) : null;
    const results = new Map<string, BatchResult>((checkpoint?.results || []).map((result: BatchResult) => [result.identity, result]));
    let batchNumber = Number(checkpoint?.completedBatches || 0);

    const checkpointValue = () => ({
      updatedAt: new Date().toISOString(), mode: "FULL_R2IMAGE_BACKFILL_CHECKPOINT", mappingPath: MAPPING_PATH,
      mappingSha256: mappingHash, backupDirectory, batchSize: BATCH_SIZE, dbConcurrency: DB_CONCURRENCY,
      preWriteSummary, eligible, completedBatches: batchNumber,
      completedReferences: [...results.values()].filter((result) => result.status === "UPDATED_VERIFIED" || result.status === "ALREADY_CORRECT_CONCURRENT").length,
      guardFailures: [...results.values()].filter((result) => result.status === "GUARD_FAILURE").length,
      failed: [...results.values()].filter((result) => result.status === "FAILED").length,
      remainingIdentities: eligible.filter((reference) => !results.has(identityFor(reference))).map(identityFor),
      results: [...results.values()].sort((left, right) => left.identity.localeCompare(right.identity)),
      safety: { cloudinaryWrites: 0, cloudinaryDeletes: 0, r2Writes: 0, r2Deletes: 0, r2Overwrites: 0, mongoDbDeletes: 0 },
    });
    const persist = async () => {
      await writeJsonAtomic(ROLLBACK_PATH, rollback);
      await writeJsonAtomic(CHECKPOINT_PATH, checkpointValue());
    };

    if (!checkpoint) {
      backupDirectory = `${BACKUP_ROOT}/r2-full-backfill-${timestampForPath()}`;
      await mkdir(backupDirectory, { recursive: true });
      const affectedCollections: CollectionName[] = ["imageCatalogue", "savedProducts"];
      const liveNames = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name));
      if (affectedCollections.some((name) => !liveNames.has(name))) throw new Error("Safety stop: an affected collection does not exist.");
      const documentsByCollection = new Map<CollectionName, Map<string, Document>>();
      const backupResults = [];
      const backupStartedAt = new Date().toISOString();
      for (const name of affectedCollections) {
        const backedUp = await backupCollection(db.collection(name), backupDirectory);
        backupResults.push(backedUp.manifest);
        documentsByCollection.set(name, backedUp.documents);
      }
      await writeJsonAtomic(`${backupDirectory}/backup-manifest.json`, {
        createdAt: new Date().toISOString(), backupStartedAt, database: DATABASE_NAME,
        format: "MongoDB canonical Extended JSON, one complete untransformed original document per line", transformed: false,
        collections: backupResults, safety: { mongoDbWrites: 0, mongoDbDeletes: 0, cloudinaryWritesOrDeletes: 0, r2WritesOrDeletes: 0 },
      });
      console.log(`Immediate pre-full-backfill backup complete: ${backupDirectory}`);

      let r2Checked = 0;
      const r2Checks = await mapWithConcurrency(assets, R2_CONCURRENCY, async (asset) => {
        const base = { publicId: asset.publicId, verified: false, reason: "" };
        if (!asset.verificationOrigin || !/^[a-f0-9]{64}$/i.test(asset.sourceSha256) || asset.sourceByteSize <= 0 || !asset.sourceContentType.startsWith("image/") || objectKeyFromR2Url(asset.r2PublicUrl, publicBaseUrl) !== asset.r2ObjectKey) return { ...base, reason: "Mapping verification evidence is incomplete or inconsistent." };
        try {
          const head = await headObject(asset.r2ObjectKey);
          const type = clean(head.ContentType).split(";")[0].toLowerCase();
          if (Number(head.ContentLength || 0) !== asset.sourceByteSize || type !== asset.sourceContentType) return { ...base, reason: "Live R2 metadata differs from verified mapping." };
          r2Checked += 1;
          if (r2Checked % 500 === 0) console.log(`R2 revalidation: ${r2Checked}/${assets.length}`);
          return { ...base, verified: true };
        } catch (error) { return { ...base, reason: safeError(error) }; }
      });
      const verifiedR2 = new Map(r2Checks.map((entry) => [entry.publicId, entry]));
      const classifications: Array<{ reference: Reference; classification: string; reason: string }> = [];
      let temporaryBlobReferences = 0;
      for (const docs of documentsByCollection.values()) for (const document of docs.values()) if (clean(document.image).startsWith("blob:")) temporaryBlobReferences += 1;
      for (const reference of references) {
        const document = documentsByCollection.get(reference.collection)?.get(reference.documentId);
        if (!document) { classifications.push({ reference, classification: "MISSING_DOCUMENT", reason: "Document not found." }); continue; }
        const parsed = parseCloudinaryUrl(document.image);
        if (!parsed) { classifications.push({ reference, classification: "NON_CLOUDINARY_CURRENT_IMAGE", reason: "Current image is not a persistent Cloudinary URL." }); continue; }
        if (clean(document.image) !== reference.imageUrl || parsed.publicId !== reference.publicId) { classifications.push({ reference, classification: "STALE_MAPPING", reason: "Current image changed after mapping." }); continue; }
        if (!verifiedR2.get(reference.publicId)?.verified) { classifications.push({ reference, classification: "UNVERIFIED_R2", reason: verifiedR2.get(reference.publicId)?.reason || "R2 not verified." }); continue; }
        const asset = assetByPublicId.get(reference.publicId)!;
        if (clean(document.r2Image)) {
          if (objectKeyFromR2Url(document.r2Image, publicBaseUrl) === asset.r2ObjectKey) classifications.push({ reference, classification: "ALREADY_CORRECT", reason: "Existing r2Image is correct." });
          else classifications.push({ reference, classification: "AMBIGUOUS", reason: "Existing r2Image points to a different object." });
          continue;
        }
        classifications.push({ reference, classification: "ELIGIBLE", reason: "Document and R2 mapping are current and verified." });
        eligible.push({ ...reference, expectedR2Url: asset.r2PublicUrl, originalR2ImageFieldExisted: Object.prototype.hasOwnProperty.call(document, "r2Image"), originalR2Image: Object.prototype.hasOwnProperty.call(document, "r2Image") ? document.r2Image : null, originalBarcode: documentBarcode(document), originalItemNo: documentItemNo(document) });
      }
      const count = (classification: string) => classifications.filter((entry) => entry.classification === classification).length;
      preWriteSummary = {
        generatedAt: new Date().toISOString(), currentMappedReferences: references.length,
        alreadyCorrect: count("ALREADY_CORRECT"), eligible: count("ELIGIBLE"), staleMappings: count("STALE_MAPPING"),
        missingDocuments: count("MISSING_DOCUMENT"), nonCloudinary: count("NON_CLOUDINARY_CURRENT_IMAGE"),
        unverifiedR2: count("UNVERIFIED_R2"), ambiguous: count("AMBIGUOUS"), temporaryBlobReferences,
        verifiedUniqueR2Assets: r2Checks.filter((entry) => entry.verified).length,
      };
      if (preWriteSummary.unverifiedR2 || preWriteSummary.ambiguous) throw new Error("Safety stop: unverified or ambiguous mappings exist; no full-backfill writes were performed.");
      rollback = {
        generatedAt: new Date().toISOString(), mode: "FULL_BACKFILL_ROLLBACK_INFORMATION_ONLY_NOT_EXECUTED",
        backupDirectory, entries: [],
        candidateOriginalStates: eligible.map((entry) => ({ collection: entry.collection, _id: entry.documentId, originalImage: entry.imageUrl, originalR2ImageFieldExisted: entry.originalR2ImageFieldExisted, originalR2Image: entry.originalR2Image, newR2Image: entry.expectedR2Url, barcode: entry.originalBarcode, itemNo: entry.originalItemNo, modified: false })),
      };
      await persist();
      console.log(`Pre-write: mapped=${preWriteSummary.currentMappedReferences}, already=${preWriteSummary.alreadyCorrect}, eligible=${preWriteSummary.eligible}, stale=${preWriteSummary.staleMappings}, missing=${preWriteSummary.missingDocuments}, nonCloudinary=${preWriteSummary.nonCloudinary}, unverified=${preWriteSummary.unverifiedR2}, ambiguous=${preWriteSummary.ambiguous}, blob=${preWriteSummary.temporaryBlobReferences}`);
    }

    const remaining = eligible.filter((reference) => !results.has(identityFor(reference)));
    let stopForIntegrity = false;
    for (let offset = 0; offset < remaining.length && !stopForIntegrity; offset += BATCH_SIZE) {
      const batch = remaining.slice(offset, offset + BATCH_SIZE);
      const byCollection = new Map<CollectionName, EligibleReference[]>();
      for (const entry of batch) byCollection.set(entry.collection, [...(byCollection.get(entry.collection) || []), entry]);
      const beforeDocuments = new Map<string, Document>();
      for (const [collection, entries] of byCollection) {
        const ids = entries.map((entry) => new ObjectId(entry.documentId));
        for (const document of await db.collection(collection).find({ _id: { $in: ids } }).toArray()) beforeDocuments.set(`${collection}|${clean(document._id)}`, document);
      }

      const attempted = await mapWithConcurrency(batch, DB_CONCURRENCY, async (entry): Promise<BatchResult> => {
        const identity = identityFor(entry);
        const before = beforeDocuments.get(identity);
        const base: BatchResult = { identity, collection: entry.collection, documentId: entry.documentId, publicId: entry.publicId, expectedImage: entry.imageUrl, expectedR2Image: entry.expectedR2Url, status: "GUARD_FAILURE", matchedCount: 0, modifiedCount: 0, imageUnchanged: false, barcodeUnchanged: false, itemNoUnchanged: false, otherBusinessDataUnchanged: false, r2ImageCorrect: false, error: "", verifiedAt: "" };
        if (!before) return { ...base, error: "Document missing before guarded update." };
        if (clean(before.image) !== entry.imageUrl) return { ...base, error: "Image changed before guarded update." };
        if (objectKeyFromR2Url(before.r2Image, publicBaseUrl) === assetByPublicId.get(entry.publicId)!.r2ObjectKey) return { ...base, status: "ALREADY_CORRECT_CONCURRENT", imageUnchanged: true, barcodeUnchanged: documentBarcode(before) === entry.originalBarcode, itemNoUnchanged: documentItemNo(before) === entry.originalItemNo, otherBusinessDataUnchanged: true, r2ImageCorrect: true, verifiedAt: new Date().toISOString() };
        const originalStateMatches = entry.originalR2ImageFieldExisted ? isDeepStrictEqual(before.r2Image, entry.originalR2Image) : !Object.prototype.hasOwnProperty.call(before, "r2Image");
        if (!originalStateMatches) return { ...base, error: "r2Image state changed before guarded update." };
        const filter: Record<string, unknown> = { _id: before._id, image: entry.imageUrl };
        if (entry.originalR2ImageFieldExisted) filter.r2Image = entry.originalR2Image;
        else filter.r2Image = { $exists: false };
        try {
          const update = await db.collection(entry.collection).updateOne(filter, { $set: { r2Image: entry.expectedR2Url } });
          return { ...base, status: update.matchedCount === 1 && update.modifiedCount === 1 ? "UPDATED_VERIFIED" : "GUARD_FAILURE", matchedCount: update.matchedCount, modifiedCount: update.modifiedCount, error: update.matchedCount === 1 && update.modifiedCount === 1 ? "" : "Conditional update did not match exactly one unchanged document." };
        } catch (error) { return { ...base, status: "FAILED", error: safeError(error) }; }
      });

      const afterDocuments = new Map<string, Document>();
      for (const [collection, entries] of byCollection) {
        const ids = entries.map((entry) => new ObjectId(entry.documentId));
        for (const document of await db.collection(collection).find({ _id: { $in: ids } }).toArray()) afterDocuments.set(`${collection}|${clean(document._id)}`, document);
      }
      for (const result of attempted) {
        const entry = batch.find((candidate) => identityFor(candidate) === result.identity)!;
        const before = beforeDocuments.get(result.identity);
        const after = afterDocuments.get(result.identity);
        if (result.status === "UPDATED_VERIFIED") {
          result.imageUnchanged = Boolean(before && after && clean(after.image) === clean(before.image));
          result.barcodeUnchanged = Boolean(before && after && documentBarcode(after) === documentBarcode(before));
          result.itemNoUnchanged = Boolean(before && after && documentItemNo(after) === documentItemNo(before));
          result.otherBusinessDataUnchanged = Boolean(before && after && isDeepStrictEqual(withoutR2Image(after), withoutR2Image(before)));
          result.r2ImageCorrect = Boolean(after && clean(after.r2Image) === entry.expectedR2Url);
          result.verifiedAt = new Date().toISOString();
          if (!result.imageUnchanged || !result.barcodeUnchanged || !result.itemNoUnchanged || !result.otherBusinessDataUnchanged || !result.r2ImageCorrect) {
            result.status = "FAILED";
            result.error = "Post-batch verification detected an unexpected difference.";
            stopForIntegrity = true;
          } else {
            const rollbackEntry = rollback.candidateOriginalStates.find((candidate: any) => `${candidate.collection}|${candidate._id}` === result.identity);
            if (rollbackEntry) rollbackEntry.modified = true;
            if (!rollback.entries.some((candidate: any) => `${candidate.collection}|${candidate._id}` === result.identity)) rollback.entries.push({ ...rollbackEntry, modified: true });
          }
        }
        results.set(result.identity, result);
      }
      batchNumber += 1;
      await persist();
      const values = [...results.values()];
      console.log(`Batch ${batchNumber}: processed=${values.length}/${eligible.length}, updated=${values.filter((result) => result.status === "UPDATED_VERIFIED").length}, concurrentCorrect=${values.filter((result) => result.status === "ALREADY_CORRECT_CONCURRENT").length}, guards=${values.filter((result) => result.status === "GUARD_FAILURE").length}, failed=${values.filter((result) => result.status === "FAILED").length}`);
      if (values.some((result) => result.status === "FAILED")) stopForIntegrity = true;
    }

    const finalDocuments = new Map<string, Document>();
    let temporaryBlobReferences = 0;
    let nonCloudinaryReferences = 0;
    let currentCloudinaryReferences = 0;
    for (const collection of ["savedProducts", "imageCatalogue"] as CollectionName[]) {
      for await (const document of db.collection(collection).find({})) {
        finalDocuments.set(`${collection}|${clean(document._id)}`, document);
        const image = clean(document.image);
        if (image.startsWith("blob:")) temporaryBlobReferences += 1;
        else if (parseCloudinaryUrl(image)) currentCloudinaryReferences += 1;
        else if (image) nonCloudinaryReferences += 1;
      }
    }
    let correctR2Image = 0;
    let missingR2Image = 0;
    let incorrectR2Image = 0;
    let staleMappings = 0;
    let missingDocuments = 0;
    const currentPublicIds = new Map<string, { total: number; correct: number }>();
    const reconciliationReferences: any[] = [];
    for (const reference of references) {
      const document = finalDocuments.get(identityFor(reference));
      const asset = assetByPublicId.get(reference.publicId)!;
      let status = "";
      if (!document) { missingDocuments += 1; status = "MISSING_DOCUMENT"; }
      else {
        const parsed = parseCloudinaryUrl(document.image);
        if (!parsed || clean(document.image) !== reference.imageUrl || parsed.publicId !== reference.publicId) { staleMappings += 1; status = "STALE_MAPPING"; }
        else {
          const group = currentPublicIds.get(reference.publicId) || { total: 0, correct: 0 };
          group.total += 1;
          if (!clean(document.r2Image)) { missingR2Image += 1; status = "MISSING_R2IMAGE"; }
          else if (objectKeyFromR2Url(document.r2Image, publicBaseUrl) !== asset.r2ObjectKey) { incorrectR2Image += 1; status = "INCORRECT_R2IMAGE"; }
          else { correctR2Image += 1; group.correct += 1; status = "CORRECT_R2IMAGE"; }
          currentPublicIds.set(reference.publicId, group);
        }
      }
      reconciliationReferences.push({ collection: reference.collection, documentId: reference.documentId, publicId: reference.publicId, status, currentImage: clean(document?.image), currentR2Image: clean(document?.r2Image), expectedImage: reference.imageUrl, expectedR2Image: asset.r2PublicUrl });
    }
    const mappedIdentities = new Set(references.map(identityFor));
    let currentCloudinaryReferencesOutsideMapping = 0;
    for (const [identity, document] of finalDocuments) if (parseCloudinaryUrl(document.image) && !mappedIdentities.has(identity)) currentCloudinaryReferencesOutsideMapping += 1;
    const guardFailures = [...results.values()].filter((result) => result.status === "GUARD_FAILURE").length;
    const failed = [...results.values()].filter((result) => result.status === "FAILED").length;
    const finalReconciliation = {
      generatedAt: new Date().toISOString(), mode: "FRESH_POST_BACKFILL_READ_ONLY_RECONCILIATION",
      currentCloudinaryBackedReferences: currentCloudinaryReferences,
      mappedReferencesReconciled: references.length, correctR2ImageReferences: correctR2Image,
      missingR2Image, incorrectR2Image, staleMappings, guardFailures, failedUpdates: failed,
      missingDocuments, ambiguousMappings: preWriteSummary.ambiguous,
      temporaryBlobReferences, nonCloudinaryReferences,
      currentCloudinaryReferencesOutsideMapping,
      uniqueCurrentMappedCloudinaryAssets: currentPublicIds.size,
      uniqueAssetsWithAllMappedReferencesCorrect: [...currentPublicIds.values()].filter((group) => group.total === group.correct).length,
      uniqueVerifiedR2AssetCoverage: assets.length,
      unexplainedOrUnaccountedReferences: currentCloudinaryReferencesOutsideMapping,
    };
    await writeJsonAtomic(RECONCILIATION_PATH, { summary: finalReconciliation, references: reconciliationReferences });

    const values = [...results.values()];
    const fullSummary = {
      generatedAt: new Date().toISOString(), mode: "FULL_R2IMAGE_METADATA_BACKFILL_ONLY",
      preWrite: preWriteSummary,
      writes: {
        attempted: values.filter((result) => result.matchedCount > 0 || result.status === "GUARD_FAILURE" || result.status === "FAILED").length,
        successfullyUpdated: values.filter((result) => result.status === "UPDATED_VERIFIED").length,
        alreadyCorrectConcurrent: values.filter((result) => result.status === "ALREADY_CORRECT_CONCURRENT").length,
        guardFailures, failed,
      },
      postWrite: finalReconciliation,
      dataIntegrity: {
        imageFieldsChanged: values.filter((result) => result.status === "UPDATED_VERIFIED" && !result.imageUnchanged).length,
        barcodeChanges: values.filter((result) => result.status === "UPDATED_VERIFIED" && !result.barcodeUnchanged).length,
        itemNoChanges: values.filter((result) => result.status === "UPDATED_VERIFIED" && !result.itemNoUnchanged).length,
        otherBusinessDataChanges: values.filter((result) => result.status === "UPDATED_VERIFIED" && !result.otherBusinessDataUnchanged).length,
        r2ImageChanges: values.filter((result) => result.status === "UPDATED_VERIFIED").length,
      },
      storage: { cloudinaryWrites: 0, cloudinaryDeletes: 0, r2Writes: 0, r2Deletes: 0, r2Overwrites: 0 },
      database: { mongoDbWrites: values.filter((result) => result.status === "UPDATED_VERIFIED").length, mongoDbDeletes: 0 },
      backupDirectory, rollbackPath: ROLLBACK_PATH, checkpointPath: CHECKPOINT_PATH,
    };
    await writeJsonAtomic(REPORT_PATH, { summary: fullSummary, results: values.sort((left, right) => left.identity.localeCompare(right.identity)) });
    await writeFile(SUMMARY_PATH, [
      "FULL R2IMAGE MONGODB BACKFILL SUMMARY", "", "PRE-WRITE",
      `Current mapped references: ${preWriteSummary.currentMappedReferences}`, `Already correct: ${preWriteSummary.alreadyCorrect}`,
      `Eligible: ${preWriteSummary.eligible}`, `Stale mappings: ${preWriteSummary.staleMappings}`,
      `Missing documents: ${preWriteSummary.missingDocuments}`, `Non-Cloudinary: ${preWriteSummary.nonCloudinary}`,
      `Unverified R2: ${preWriteSummary.unverifiedR2}`, `Ambiguous: ${preWriteSummary.ambiguous}`, "", "WRITES",
      `Attempted: ${fullSummary.writes.attempted}`, `Successfully updated: ${fullSummary.writes.successfullyUpdated}`,
      `Already correct concurrently: ${fullSummary.writes.alreadyCorrectConcurrent}`, `Guard failures: ${fullSummary.writes.guardFailures}`,
      `Failed: ${fullSummary.writes.failed}`, "", "POST-WRITE",
      `Current Cloudinary-backed references: ${finalReconciliation.currentCloudinaryBackedReferences}`,
      `Correct r2Image references: ${finalReconciliation.correctR2ImageReferences}`,
      `Missing r2Image: ${finalReconciliation.missingR2Image}`, `Incorrect r2Image: ${finalReconciliation.incorrectR2Image}`,
      `Stale mappings: ${finalReconciliation.staleMappings}`, `Current references outside mapping: ${finalReconciliation.currentCloudinaryReferencesOutsideMapping}`,
      `Unique assets with all mapped references correct: ${finalReconciliation.uniqueAssetsWithAllMappedReferencesCorrect}`,
      `Unique verified R2 asset coverage: ${finalReconciliation.uniqueVerifiedR2AssetCoverage}`, `Temporary/blob references: ${finalReconciliation.temporaryBlobReferences}`, "", "DATA INTEGRITY",
      `image fields changed: ${fullSummary.dataIntegrity.imageFieldsChanged}`, `barcode changes: ${fullSummary.dataIntegrity.barcodeChanges}`,
      `Item No changes: ${fullSummary.dataIntegrity.itemNoChanges}`, `other business-data changes: ${fullSummary.dataIntegrity.otherBusinessDataChanges}`,
      `r2Image changes: ${fullSummary.dataIntegrity.r2ImageChanges}`, "", "STORAGE",
      `Cloudinary writes/deletes: 0`, `R2 writes/deletes/overwrites: 0`, `MongoDB deletes: 0`, "", "BACKUP / ROLLBACK",
      `Backup: ${backupDirectory}`, `Rollback map: ${ROLLBACK_PATH}`, "",
      "Cloudinary remains the primary provider.", "The application read path and environment variables were NOT changed.",
    ].join("\n") + "\n", "utf8");
    console.log(await readFile(SUMMARY_PATH, "utf8"));
    const success = !stopForIntegrity && !guardFailures && !failed && !finalReconciliation.missingR2Image && !finalReconciliation.incorrectR2Image && !finalReconciliation.staleMappings && !finalReconciliation.missingDocuments && !finalReconciliation.currentCloudinaryReferencesOutsideMapping && fullSummary.dataIntegrity.imageFieldsChanged === 0 && fullSummary.dataIntegrity.barcodeChanges === 0 && fullSummary.dataIntegrity.itemNoChanges === 0 && fullSummary.dataIntegrity.otherBusinessDataChanges === 0;
    if (!success) process.exitCode = 1;
  } finally { await client.close(); }
};

await main();
