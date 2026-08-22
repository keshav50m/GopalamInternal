import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { BSON, MongoClient, type Document } from "mongodb";

type MigrationReference = {
  _id: string;
  barcode: string;
  itemNo: string;
  normalizedItemNo?: string;
  imageUrl: string;
};

type MigrationEntry = {
  publicId: string;
  sourceUrls: string[];
  preferredSourceUrl: string;
  format: string;
  bytes: number | null;
  proposedR2ObjectKey: string;
  proposedR2Url: string;
  savedProductReferences: MigrationReference[];
  imageCatalogueReferences: MigrationReference[];
};

type FieldReference = {
  collection: string;
  documentId: string;
  fieldPath: string;
  value: string;
  barcode: string;
  itemNo: string;
};

type SourceValidation = {
  publicId: string;
  sourceUrl: string;
  status: "VALID" | "BROKEN_SOURCE";
  httpStatus: number | null;
  contentType: string;
  responseContentLength: number | null;
  bytesRead: number;
  expectedBytes: number | null;
  sha256: string;
  magicType: string;
  checks: {
    httpOk: boolean;
    imageContentType: boolean;
    positiveSize: boolean;
    validImageSignature: boolean;
    metadataSizeMatches: boolean | null;
  };
  error: string;
};

const DATABASE_NAME = String(process.env.MONGO_DB_NAME || "gopalamJewels").trim();
const REPORT_DIR = "reports";
const BACKUP_ROOT = "migration-backups";
const CHECKPOINT_FILE = `${REPORT_DIR}/cloudinary-source-validation.checkpoint.json`;
const MIGRATION_MAP_FILE = `${REPORT_DIR}/cloudinary-to-r2-migration-map.json`;
const FIELD_NAMES = new Set([
  "barcode", "barCode", "BARCODE", "itemNo", "itemno", "ITEMNO",
  "image", "imageUrl", "imageURL", "previewUrl", "previewURL",
]);
const IMAGE_FIELD_PATTERN = /(?:^|\.)(?:image|imageurl|image_url|previewurl|preview_url)$/i;
const BARCODE_FIELD_PATTERN = /(?:^|\.)(?:barcode|bar_code)$/i;
const ITEM_FIELD_PATTERN = /(?:^|\.)(?:itemno|item_no)$/i;

const clean = (value: unknown) => String(value ?? "").trim();
const normalizeItemNo = (value: unknown) => clean(value).toUpperCase();
const normalizeBarcode = (value: unknown) => clean(value);
const unique = <T>(values: T[]) => [...new Set(values)];
const timestampForPath = () => new Date().toISOString().replace(/[:.]/g, "-");
const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.replace(/https?:\/\/\S+/g, "[redacted-url]").slice(0, 500);
};

const parseCloudinaryUrl = (input: unknown) => {
  try {
    const url = new URL(clean(input));
    if (url.hostname.toLowerCase() !== "res.cloudinary.com") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 4) return null;
    const [cloudName, resourceType, deliveryType, ...delivery] = segments;
    const versionIndex = delivery.findIndex((part) => /^v\d+$/.test(part));
    let asset = versionIndex >= 0 ? delivery.slice(versionIndex + 1) : delivery;
    if (versionIndex < 0) {
      while (asset.length > 1 && /^(?:[a-z]{1,4}_.+|s--.+--|t_.+)(?:,.*)?$/i.test(asset[0])) asset = asset.slice(1);
    }
    if (!asset.length) return null;
    asset = asset.map((part) => decodeURIComponent(part));
    asset[asset.length - 1] = asset.at(-1)!.replace(/\.(?:avif|bmp|gif|heic|heif|ico|j2k|jp2|jpeg|jpg|jxl|png|psd|svg|tga|tif|tiff|webp)$/i, "");
    const publicId = asset.join("/");
    return publicId ? { cloudName, resourceType, deliveryType, publicId } : null;
  } catch {
    return null;
  }
};

const sha256File = async (path: string) => {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => hash.update(chunk));
  await once(stream, "end");
  return hash.digest("hex");
};

const walkDocument = (
  value: unknown,
  visitor: (path: string, value: unknown) => void,
  path = "",
) => {
  if (Array.isArray(value)) {
    value.forEach((child, index) => walkDocument(child, visitor, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object" || value instanceof Date || value instanceof Uint8Array) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    visitor(childPath, child);
    walkDocument(child, visitor, childPath);
  }
};

const documentIdentity = (document: Document) => {
  let barcode = normalizeBarcode(document.barcode ?? document.data?.BARCODE);
  let itemNo = clean(document.itemNo ?? document.data?.ITEMNO);
  if (!barcode || !itemNo) {
    walkDocument(document, (path, value) => {
      if (!barcode && BARCODE_FIELD_PATTERN.test(path)) barcode = normalizeBarcode(value);
      if (!itemNo && ITEM_FIELD_PATTERN.test(path)) itemNo = clean(value);
    });
  }
  return { barcode, itemNo };
};

const classifyUrl = (value: string, r2BaseUrl: string) => {
  if (!value) return "EMPTY";
  if (value.startsWith("blob:")) return "TEMPORARY_BLOB_REFERENCE";
  const cloudinary = parseCloudinaryUrl(value);
  if (cloudinary) return "CLOUDINARY";
  try {
    const url = new URL(value);
    const r2Host = r2BaseUrl ? new URL(r2BaseUrl).hostname : "";
    if (url.hostname === r2Host || /\.r2\.dev$/i.test(url.hostname)) return "R2";
    if (url.protocol === "http:" || url.protocol === "https:") return "OTHER_HTTP";
  } catch {}
  return "MALFORMED";
};

const detectImageSignature = (bytes: Uint8Array) => {
  const hex = Buffer.from(bytes).toString("hex");
  const ascii = Buffer.from(bytes).toString("ascii");
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("89504e470d0a1a0a")) return "image/png";
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return "image/gif";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  if (hex.startsWith("424d")) return "image/bmp";
  if (hex.startsWith("49492a00") || hex.startsWith("4d4d002a")) return "image/tiff";
  if (ascii.slice(4, 12).includes("ftypavif") || ascii.slice(4, 12).includes("ftypavis")) return "image/avif";
  if (/^\s*<\?xml|^\s*<svg/i.test(ascii)) return "image/svg+xml";
  return "unknown";
};

const validateSource = async (entry: MigrationEntry): Promise<SourceValidation> => {
  const sourceUrl = clean(entry.preferredSourceUrl || entry.sourceUrls[0]);
  const base = {
    publicId: entry.publicId,
    sourceUrl,
    httpStatus: null,
    contentType: "",
    responseContentLength: null,
    bytesRead: 0,
    expectedBytes: typeof entry.bytes === "number" ? entry.bytes : null,
    sha256: "",
    magicType: "unknown",
  };
  if (!parseCloudinaryUrl(sourceUrl)) {
    return {
      ...base,
      status: "BROKEN_SOURCE",
      checks: { httpOk: false, imageContentType: false, positiveSize: false, validImageSignature: false, metadataSizeMatches: null },
      error: "Preferred source is not a parseable Cloudinary URL.",
    };
  }

  try {
    const response = await fetch(sourceUrl, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
    const contentType = clean(response.headers.get("content-type")).split(";")[0].toLowerCase();
    const contentLengthHeader = clean(response.headers.get("content-length"));
    const responseContentLength = /^\d+$/.test(contentLengthHeader) ? Number(contentLengthHeader) : null;
    const hash = createHash("sha256");
    let bytesRead = 0;
    const signatureChunks: Buffer[] = [];
    let signatureBytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buffer = Buffer.from(value);
        hash.update(buffer);
        bytesRead += buffer.length;
        if (signatureBytes < 512) {
          const slice = buffer.subarray(0, 512 - signatureBytes);
          signatureChunks.push(slice);
          signatureBytes += slice.length;
        }
      }
    }
    const magicType = detectImageSignature(Buffer.concat(signatureChunks));
    const checks = {
      httpOk: response.ok,
      imageContentType: contentType.startsWith("image/"),
      positiveSize: bytesRead > 0,
      validImageSignature: magicType.startsWith("image/"),
      metadataSizeMatches: typeof entry.bytes === "number" ? bytesRead === entry.bytes : null,
    };
    const valid = checks.httpOk && checks.imageContentType && checks.positiveSize && checks.validImageSignature && checks.metadataSizeMatches !== false;
    return {
      ...base,
      status: valid ? "VALID" : "BROKEN_SOURCE",
      httpStatus: response.status,
      contentType,
      responseContentLength,
      bytesRead,
      sha256: hash.digest("hex"),
      magicType,
      checks,
      error: valid ? "" : "One or more source validation checks failed.",
    };
  } catch (error) {
    return {
      ...base,
      status: "BROKEN_SOURCE",
      checks: { httpOk: false, imageContentType: false, positiveSize: false, validImageSignature: false, metadataSizeMatches: null },
      error: safeError(error),
    };
  }
};

const mapWithConcurrency = async <T, R>(values: T[], concurrency: number, action: (value: T, index: number) => Promise<R>) => {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await action(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
};

const backupCollection = async (collection: ReturnType<ReturnType<MongoClient["db"]>["collection"]>, directory: string) => {
  const filename = `${collection.collectionName}.canonical-ejson.ndjson`;
  const path = `${directory}/${filename}`;
  const stream = createWriteStream(path, { encoding: "utf8", flags: "wx" });
  let documentCount = 0;
  for await (const document of collection.find({}).sort({ _id: 1 })) {
    const line = `${BSON.EJSON.stringify(document, { relaxed: false })}\n`;
    if (!stream.write(line)) await once(stream, "drain");
    documentCount += 1;
  }
  stream.end();
  await once(stream, "finish");
  const fileStat = await stat(path);
  return { collection: collection.collectionName, documentCount, backupFilename: filename, bytes: fileStat.size, sha256: await sha256File(path) };
};

const loadCheckpoint = async () => {
  try {
    const data = JSON.parse(await readFile(CHECKPOINT_FILE, "utf8")) as SourceValidation[];
    return new Map(data.filter((entry) => entry.status === "VALID").map((entry) => [entry.publicId, entry]));
  } catch {
    return new Map<string, SourceValidation>();
  }
};

const writeJsonAtomic = async (path: string, value: unknown) => {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
};

const main = async () => {
  const mongoUri = clean(process.env.MONGO_URI);
  if (!mongoUri) throw new Error("MONGO_URI is required and will never be logged.");
  const r2BaseUrl = clean(process.env.R2_PUBLIC_BASE_URL);
  const migrationMap = JSON.parse(await readFile(MIGRATION_MAP_FILE, "utf8")) as MigrationEntry[];
  const backupTimestamp = timestampForPath();
  const backupDirectory = `${BACKUP_ROOT}/${backupTimestamp}`;
  await mkdir(REPORT_DIR, { recursive: true });
  await mkdir(backupDirectory, { recursive: true });

  const client = new MongoClient(mongoUri, { readPreference: "secondaryPreferred" });
  try {
    await client.connect();
    const db = client.db(DATABASE_NAME);
    const collectionInfos = await db.listCollections({}, { nameOnly: true }).toArray();
    const databaseReferences: FieldReference[] = [];
    const collectionSummaries: Array<{ collection: string; documentCount: number; matchingDocumentCount: number; discoveredFieldPaths: string[] }> = [];
    const documentsByCollection = new Map<string, Map<string, Document>>();

    for (const info of collectionInfos.sort((left, right) => left.name.localeCompare(right.name))) {
      const documents = new Map<string, Document>();
      const paths = new Set<string>();
      let documentCount = 0;
      let matchingDocumentCount = 0;
      for await (const document of db.collection(info.name).find({})) {
        documentCount += 1;
        let matched = false;
        const identity = documentIdentity(document);
        walkDocument(document, (path, value) => {
          const leaf = path.replace(/\[\d+\]/g, "").split(".").at(-1) || "";
          if (!FIELD_NAMES.has(leaf) && !IMAGE_FIELD_PATTERN.test(path) && !BARCODE_FIELD_PATTERN.test(path) && !ITEM_FIELD_PATTERN.test(path)) return;
          paths.add(path.replace(/\[\d+\]/g, "[]"));
          matched = true;
          if (IMAGE_FIELD_PATTERN.test(path) && typeof value === "string" && clean(value)) {
            databaseReferences.push({ collection: info.name, documentId: clean(document._id), fieldPath: path, value: clean(value), ...identity });
          }
        });
        if (matched) {
          matchingDocumentCount += 1;
          documents.set(clean(document._id), document);
        }
      }
      if (paths.size) {
        documentsByCollection.set(info.name, documents);
        collectionSummaries.push({ collection: info.name, documentCount, matchingDocumentCount, discoveredFieldPaths: [...paths].sort() });
      }
    }

    const backupEntries = [];
    for (const summary of collectionSummaries) backupEntries.push(await backupCollection(db.collection(summary.collection), backupDirectory));
    const backupManifest = {
      createdAt: new Date().toISOString(),
      database: DATABASE_NAME,
      format: "MongoDB canonical Extended JSON, one complete original document per line",
      transformed: false,
      collections: backupEntries,
      safety: { databaseWrites: 0, cloudinaryWrites: 0, r2Writes: 0 },
    };
    await writeJsonAtomic(`${backupDirectory}/backup-manifest.json`, backupManifest);

    const referencesByCollectionAndId = new Map(databaseReferences.map((reference) => [`${reference.collection}|${reference.documentId}|${reference.fieldPath}`, reference]));
    const cloudinaryReferences = databaseReferences.filter((reference) => classifyUrl(reference.value, r2BaseUrl) === "CLOUDINARY");
    const blobReferences = databaseReferences.filter((reference) => classifyUrl(reference.value, r2BaseUrl) === "TEMPORARY_BLOB_REFERENCE");
    const r2References = databaseReferences.filter((reference) => classifyUrl(reference.value, r2BaseUrl) === "R2");
    const malformedReferences = databaseReferences.filter((reference) => classifyUrl(reference.value, r2BaseUrl) === "MALFORMED");
    const publicIdsInAllCollections = new Set(cloudinaryReferences.map((reference) => parseCloudinaryUrl(reference.value)!.publicId));

    const barcodes = new Map<string, { itemNos: Set<string>; publicIds: Set<string>; references: FieldReference[] }>();
    for (const reference of cloudinaryReferences) {
      if (!reference.barcode) continue;
      const group = barcodes.get(reference.barcode) || { itemNos: new Set(), publicIds: new Set(), references: [] };
      if (reference.itemNo) group.itemNos.add(normalizeItemNo(reference.itemNo));
      group.publicIds.add(parseCloudinaryUrl(reference.value)!.publicId);
      group.references.push(reference);
      barcodes.set(reference.barcode, group);
    }
    const barcodeConflicts = [...barcodes.entries()].filter(([, group]) => group.itemNos.size > 1 || group.publicIds.size > 1).map(([barcode, group]) => ({
      barcode,
      itemNos: [...group.itemNos],
      publicIds: [...group.publicIds],
      conflictTypes: [group.itemNos.size > 1 ? "SAME_BARCODE_DIFFERENT_ITEM_NUMBERS" : "", group.publicIds.size > 1 ? "SAME_BARCODE_DIFFERENT_IMAGES" : ""].filter(Boolean),
      references: group.references,
    }));
    const conflictingBarcodes = new Set(barcodeConflicts.map((conflict) => conflict.barcode));

    const checkpoint = await loadCheckpoint();
    let completedSinceWrite = 0;
    const validations = await mapWithConcurrency(migrationMap, 4, async (entry, index) => {
      const cached = checkpoint.get(entry.publicId);
      if (cached && cached.expectedBytes === entry.bytes) return cached;
      const validation = await validateSource(entry);
      checkpoint.set(entry.publicId, validation);
      completedSinceWrite += 1;
      if (completedSinceWrite >= 50 || index === migrationMap.length - 1) {
        completedSinceWrite = 0;
        await writeJsonAtomic(CHECKPOINT_FILE, [...checkpoint.values()]);
      }
      return validation;
    });
    await writeJsonAtomic(CHECKPOINT_FILE, validations);
    const validationByPublicId = new Map(validations.map((validation) => [validation.publicId, validation]));

    const entryValidations = migrationMap.map((entry) => {
      const referencedDocuments = [
        ...entry.savedProductReferences.map((ref) => ({ collection: "savedProducts", ...ref })),
        ...entry.imageCatalogueReferences.map((ref) => ({ collection: "imageCatalogue", ...ref })),
      ];
      const referenceChecks = referencedDocuments.map((reference) => {
        const document = documentsByCollection.get(reference.collection)?.get(clean(reference._id));
        const liveImageFields = databaseReferences.filter((live) => live.collection === reference.collection && live.documentId === clean(reference._id));
        const matchingPublicId = liveImageFields.some((live) => parseCloudinaryUrl(live.value)?.publicId === entry.publicId);
        const identity = document ? documentIdentity(document) : { barcode: "", itemNo: "" };
        return {
          collection: reference.collection,
          documentId: clean(reference._id),
          documentExists: Boolean(document),
          barcodeExpected: normalizeBarcode(reference.barcode),
          barcodeActual: identity.barcode,
          barcodeMatches: !reference.barcode || normalizeBarcode(reference.barcode) === identity.barcode,
          itemNoExpected: clean(reference.itemNo),
          itemNoActual: identity.itemNo,
          itemNoMatches: !reference.itemNo || normalizeItemNo(reference.itemNo) === normalizeItemNo(identity.itemNo),
          publicIdMatches: matchingPublicId,
          liveImageFields,
        };
      });
      const source = validationByPublicId.get(entry.publicId)!;
      const hasRelationshipFailure = referenceChecks.some((check) => !check.documentExists || !check.barcodeMatches || !check.itemNoMatches || !check.publicIdMatches);
      const hasBarcodeConflict = referencedDocuments.some((reference) => reference.barcode && conflictingBarcodes.has(normalizeBarcode(reference.barcode)));
      let classification: "SAFE_TO_MIGRATE" | "BROKEN_SOURCE" | "AMBIGUOUS_RELATIONSHIP" | "CONFLICT" | "NON_CLOUDINARY" | "ALREADY_R2" | "UNKNOWN" = "SAFE_TO_MIGRATE";
      if (!parseCloudinaryUrl(entry.preferredSourceUrl)) classification = "NON_CLOUDINARY";
      else if (source.status !== "VALID") classification = "BROKEN_SOURCE";
      else if (hasRelationshipFailure) classification = "CONFLICT";
      else if (hasBarcodeConflict) classification = "AMBIGUOUS_RELATIONSHIP";
      return { ...entry, classification, sourceValidation: source, referenceChecks };
    });

    const orphanAudit = JSON.parse(await readFile(`${REPORT_DIR}/cloudinary-orphan-candidates.json`, "utf8"));
    const orphanValidation = (orphanAudit.assets || []).map((asset: { publicId: string; secureUrl?: string }) => ({
      ...asset,
      referencesFoundAcrossAllCollections: cloudinaryReferences.filter((reference) => parseCloudinaryUrl(reference.value)?.publicId === asset.publicId),
      classification: publicIdsInAllCollections.has(asset.publicId) ? "REFERENCED_OUTSIDE_PRIOR_AUDIT_SCOPE" : "POSSIBLE_ORPHAN",
    }));

    const itemNoImageGroups = new Map<string, Set<string>>();
    for (const reference of cloudinaryReferences) {
      if (!reference.itemNo) continue;
      const key = normalizeItemNo(reference.itemNo);
      const ids = itemNoImageGroups.get(key) || new Set<string>();
      ids.add(parseCloudinaryUrl(reference.value)!.publicId);
      itemNoImageGroups.set(key, ids);
    }
    const sameItemMultipleImages = [...itemNoImageGroups.entries()].filter(([, ids]) => ids.size > 1);
    const exactCloudinaryUrlGroups = new Map<string, FieldReference[]>();
    for (const reference of cloudinaryReferences) exactCloudinaryUrlGroups.set(reference.value, [...(exactCloudinaryUrlGroups.get(reference.value) || []), reference]);
    const duplicateUrlGroups = [...exactCloudinaryUrlGroups.values()].filter((group) => group.length > 1);
    const sharedRecordCount = unique(duplicateUrlGroups.flat().map((reference) => `${reference.collection}|${reference.documentId}`)).length;

    const savedProducts = documentsByCollection.get("savedProducts") || new Map();
    const productDocuments = [...savedProducts.values()];
    const productImageReferences = databaseReferences.filter((reference) => reference.collection === "savedProducts");
    const summary = {
      generatedAt: new Date().toISOString(),
      mode: "PRE_MIGRATION_READ_ONLY_SAFETY_GATE",
      database: {
        collectionsInspected: collectionInfos.length,
        affectedCollections: collectionSummaries.length,
        affectedCollectionNames: collectionSummaries.map((summary) => summary.collection),
        totalProductRecords: productDocuments.length,
        uniqueBarcodes: new Set(productDocuments.map((document) => documentIdentity(document).barcode).filter(Boolean)).size,
        uniqueItemNumbers: new Set(productDocuments.map((document) => normalizeItemNo(documentIdentity(document).itemNo)).filter(Boolean)).size,
        productRecordsContainingImageUrls: new Set(productImageReferences.map((reference) => reference.documentId)).size,
        cloudinaryUrlReferences: cloudinaryReferences.length,
        r2UrlReferences: r2References.length,
        temporaryBlobReferences: blobReferences.length,
        malformedUrlReferences: malformedReferences.length,
        missingProductImageUrls: productDocuments.length - new Set(productImageReferences.map((reference) => reference.documentId)).size,
      },
      relationships: {
        uniqueExactCloudinaryUrls: exactCloudinaryUrlGroups.size,
        duplicateCloudinaryUrlGroups: duplicateUrlGroups.length,
        mongoDbRecordsSharingAnExactCloudinaryUrl: sharedRecordCount,
        sameItemNumberMultipleImages: sameItemMultipleImages.length,
        barcodeRelationshipConflicts: barcodeConflicts.length,
      },
      migration: {
        proposedAssets: migrationMap.length,
        safeToMigrate: entryValidations.filter((entry) => entry.classification === "SAFE_TO_MIGRATE").length,
        ambiguousRelationship: entryValidations.filter((entry) => entry.classification === "AMBIGUOUS_RELATIONSHIP").length,
        conflicts: entryValidations.filter((entry) => entry.classification === "CONFLICT").length,
        brokenSources: entryValidations.filter((entry) => entry.classification === "BROKEN_SOURCE").length,
        nonCloudinary: entryValidations.filter((entry) => entry.classification === "NON_CLOUDINARY").length,
        alreadyR2: 0,
        unknown: 0,
      },
      orphans: {
        priorCandidates: orphanValidation.length,
        referencedOutsidePriorAuditScope: orphanValidation.filter((entry: { classification: string }) => entry.classification === "REFERENCED_OUTSIDE_PRIOR_AUDIT_SCOPE").length,
        possibleOrphansAfterAllCollectionScan: orphanValidation.filter((entry: { classification: string }) => entry.classification === "POSSIBLE_ORPHAN").length,
      },
      backup: { status: "COMPLETE", directory: backupDirectory, manifest: `${backupDirectory}/backup-manifest.json`, collections: backupEntries.length },
      safety: { mongoDbWrites: 0, cloudinaryWritesOrDeletes: 0, r2Writes: 0, cloudinaryAssetsDeleted: 0 },
    };

    await writeJsonAtomic(`${REPORT_DIR}/pre-migration-safety-gate.json`, {
      summary,
      collectionMapping: collectionSummaries,
      databaseReferences,
      barcodeConflicts,
      sameItemNumberMultipleImages: sameItemMultipleImages.map(([itemNo, ids]) => ({ itemNo, publicIds: [...ids] })),
      entryValidations,
    });
    await writeJsonAtomic(`${REPORT_DIR}/cloudinary-source-validation.json`, validations);
    await writeJsonAtomic(`${REPORT_DIR}/cloudinary-orphan-candidates-validated.json`, orphanValidation);
    await writeJsonAtomic(`${REPORT_DIR}/temporary-blob-references.json`, blobReferences.map((reference) => ({ ...reference, classification: "TEMPORARY_BLOB_REFERENCE", storedInMongoDb: true })));
    await writeJsonAtomic(`${REPORT_DIR}/barcode-image-conflicts.json`, barcodeConflicts);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await client.close();
  }
};

await main();
