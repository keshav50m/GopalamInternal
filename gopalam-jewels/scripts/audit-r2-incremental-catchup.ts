import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { MongoClient, type Document } from "mongodb";

type CollectionName = "savedProducts" | "imageCatalogue";
type Reference = {
  collection: CollectionName;
  documentId: string;
  field: "image";
  imageUrl: string;
  r2Image: string;
  barcode: string;
  itemNo: string;
  publicId?: string;
};
type CloudinaryResource = {
  publicId: string;
  secureUrl: string;
  format: string;
  bytes: number;
  version: number;
};
type BinaryValidation = {
  status: "VERIFIED" | "MISSING" | "FAILED";
  bytes: number;
  sha256: string;
  contentType: string;
  publicAccessible?: boolean;
  httpStatus?: number;
  error: string;
};
type PriorAsset = {
  publicId: string;
  cloudinarySourceUrl: string;
  r2ObjectKey: string;
  r2PublicUrl: string;
  sourceByteSize: number;
  sourceSha256: string;
  sourceContentType: string;
  verificationStatus: string;
};

const DATABASE_NAME = process.env.MONGO_DB_NAME?.trim() || "gopalamJewels";
const REPORT_DIRECTORY = "reports";
const REPORT_PATH = `${REPORT_DIRECTORY}/r2-incremental-catchup-dry-run.json`;
const SUMMARY_PATH = `${REPORT_DIRECTORY}/r2-incremental-catchup-dry-run-summary.txt`;
const MAP_PATH = `${REPORT_DIRECTORY}/r2-incremental-catchup-map.json`;
const CHECKPOINT_PATH = `${REPORT_DIRECTORY}/r2-incremental-catchup-checkpoint.json`;
const CONCURRENCY = 4;
const CHECKPOINT_INTERVAL = 100;
const MAX_READ_ATTEMPTS = 3;
const IMAGE_FORMATS = new Set(["avif", "bmp", "gif", "heic", "heif", "ico", "j2k", "jp2", "jpeg", "jpg", "jxl", "png", "psd", "svg", "tga", "tif", "tiff", "webp"]);

const clean = (value: unknown) => String(value ?? "").trim();
const unique = <T>(values: T[]) => [...new Set(values)];
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.replace(/https?:\/\/\S+/g, "[redacted-url]").slice(0, 800);
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
const mapWithConcurrency = async <T, R>(values: T[], concurrency: number, task: (value: T, index: number) => Promise<R>) => {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await task(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

const safeDecode = (value: string) => {
  try { return decodeURIComponent(value); } catch { return null; }
};
const looksLikeTransformation = (segment: string) => {
  if (/^s--[^/]+--$/.test(segment) || /^t_[^/]+$/.test(segment) || /^(?:if_|if_else$|if_end$)/.test(segment)) return true;
  return segment.split(",").every((component) => /^(?:a|ac|af|ar|b|bo|br|c|co|cs|d|dl|dn|dpr|du|e|eo|f|fl|fn|fps|g|h|ki|l|o|p|pg|q|r|so|sp|t|u|vc|vs|w|x|y|z)_.+/.test(component));
};
const parseCloudinaryUrl = (input: unknown) => {
  let url: URL;
  try { url = new URL(clean(input)); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.hostname.toLowerCase() !== "res.cloudinary.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4) return null;
  const [cloud, resourceType, deliveryType, ...delivery] = parts;
  const versionIndex = delivery.findIndex((segment) => /^v\d+$/.test(segment));
  let assetParts: string[];
  if (versionIndex >= 0) assetParts = delivery.slice(versionIndex + 1);
  else {
    let start = 0;
    while (start < delivery.length - 1 && looksLikeTransformation(delivery[start])) start += 1;
    assetParts = delivery.slice(start);
  }
  const decoded = assetParts.map(safeDecode);
  if (!safeDecode(cloud) || !safeDecode(resourceType) || !safeDecode(deliveryType) || !decoded.length || decoded.some((part) => !part)) return null;
  const publicParts = decoded as string[];
  const last = publicParts.at(-1)!;
  const extensionCandidate = last.match(/\.([A-Za-z0-9]+)$/)?.[1].toLowerCase() || "";
  const extension = IMAGE_FORMATS.has(extensionCandidate) ? extensionCandidate : "";
  if (extension) publicParts[publicParts.length - 1] = last.slice(0, -(extension.length + 1));
  const publicId = publicParts.join("/");
  if (!publicId || publicParts.some((part) => part === "." || part === "..")) return null;
  return { publicId, extension, cloudName: safeDecode(cloud)! };
};
const looksCloudinary = (value: string) => {
  try { return new URL(value).hostname.toLowerCase() === "res.cloudinary.com"; } catch { return /res\.cloudinary\.com/i.test(value); }
};
const classifyUrl = (value: string, r2BaseUrl: string) => {
  if (!value) return "EMPTY";
  if (parseCloudinaryUrl(value)) return "CLOUDINARY";
  if (looksCloudinary(value)) return "MALFORMED_CLOUDINARY";
  try {
    const url = new URL(value);
    if (url.protocol === "blob:") return "TEMPORARY_BLOB";
    const base = new URL(r2BaseUrl);
    if (url.hostname.toLowerCase() === base.hostname.toLowerCase() || /\.r2\.(?:dev|cloudflarestorage\.com)$/i.test(url.hostname)) return "R2";
    if (/^https?:$/.test(url.protocol)) return "OTHER_HTTP";
  } catch {}
  return "MALFORMED_OTHER";
};
const proposedObjectKey = (publicId: string, format: string) => {
  const encoded = publicId.split("/").map((part) => encodeURIComponent(part)).join("/");
  const safeFormat = /^[a-z0-9]+$/i.test(format) ? format.toLowerCase() : "bin";
  return `migrated/${encoded}.${safeFormat}`;
};
const publicUrlForKey = (baseUrl: string, key: string) =>
  `${baseUrl.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
const objectKeyFromR2Url = (value: string, baseUrl: string) => {
  try {
    const url = new URL(value);
    const base = new URL(baseUrl);
    if (url.hostname.toLowerCase() !== base.hostname.toLowerCase()) return null;
    const basePath = base.pathname.replace(/\/+$/, "");
    if (basePath && !url.pathname.startsWith(`${basePath}/`)) return null;
    const encodedPath = url.pathname.slice(basePath.length).replace(/^\/+/, "");
    const parts = encodedPath.split("/").filter(Boolean).map(safeDecode);
    if (!parts.length || parts.some((part) => part === null || part === "" || part === "." || part === "..")) return null;
    return (parts as string[]).join("/");
  } catch { return null; }
};
const formatForContentType = (contentType: string) => ({
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg", "image/tiff": "tiff", "image/bmp": "bmp",
}[contentType] || "");

const fetchBytes = async (url: string): Promise<BinaryValidation> => {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
      if (!response.ok) return { status: response.status === 404 ? "MISSING" : "FAILED", bytes: 0, sha256: "", contentType: clean(response.headers.get("content-type")).split(";")[0].toLowerCase(), httpStatus: response.status, error: `HTTP ${response.status}` };
      const contentType = clean(response.headers.get("content-type")).split(";")[0].toLowerCase();
      const body = new Uint8Array(await response.arrayBuffer());
      if (!body.byteLength) throw new Error("Response body is empty.");
      if (!contentType.startsWith("image/")) throw new Error(`Content-Type is not image/*: ${contentType || "missing"}.`);
      return { status: "VERIFIED", bytes: body.byteLength, sha256: sha256(body), contentType, httpStatus: response.status, error: "" };
    } catch (error) {
      lastError = safeError(error);
      if (attempt < MAX_READ_ATTEMPTS) await delay(attempt * 1000);
    }
  }
  return { status: "FAILED", bytes: 0, sha256: "", contentType: "", error: lastError };
};

const listCloudinaryResources = async () => {
  const cloudName = clean(process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME);
  const apiKey = clean(process.env.CLOUDINARY_API_KEY || process.env.API_KEY);
  const apiSecret = clean(process.env.CLOUDINARY_API_SECRET || process.env.API_SECRET);
  if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary Admin API credentials are required for this current-state audit.");
  const require = createRequire(new URL("../server/package.json", import.meta.url).pathname);
  const cloudinary = require("cloudinary").v2;
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  const resources: CloudinaryResource[] = [];
  let nextCursor: string | undefined;
  let requests = 0;
  do {
    const response = await cloudinary.api.resources({ resource_type: "image", type: "upload", max_results: 500, next_cursor: nextCursor });
    requests += 1;
    for (const resource of response.resources || []) resources.push({
      publicId: clean(resource.public_id), secureUrl: clean(resource.secure_url), format: clean(resource.format).toLowerCase(), bytes: Number(resource.bytes || 0), version: Number(resource.version || 0),
    });
    nextCursor = response.next_cursor;
  } while (nextCursor);
  return { resources, requests };
};

const readDatabase = async (client: MongoClient) => {
  const db = client.db(DATABASE_NAME);
  const [savedProducts, imageCatalogue] = await Promise.all([
    db.collection("savedProducts").find({}, { projection: { barcode: 1, image: 1, r2Image: 1, "data.ITEMNO": 1 } }).toArray(),
    db.collection("imageCatalogue").find({}, { projection: { itemNo: 1, image: 1, r2Image: 1 } }).toArray(),
  ]);
  const references: Reference[] = [];
  const missing: Array<Omit<Reference, "imageUrl" | "field">> = [];
  const add = (collection: CollectionName, document: Document, barcode: unknown, itemNo: unknown) => {
    const base = { collection, documentId: clean(document._id), barcode: clean(barcode), itemNo: clean(itemNo), r2Image: clean(document.r2Image) };
    const imageUrl = clean(document.image);
    if (imageUrl) references.push({ ...base, field: "image", imageUrl });
    else missing.push(base);
  };
  savedProducts.forEach((document) => add("savedProducts", document, document.barcode, document.data?.ITEMNO));
  imageCatalogue.forEach((document) => add("imageCatalogue", document, "", document.itemNo));
  return { savedProductsCount: savedProducts.length, imageCatalogueCount: imageCatalogue.length, references, missing };
};

const main = async () => {
  const mongoUri = required("MONGO_URI");
  const r2PublicBaseUrl = required("R2_PUBLIC_BASE_URL");
  const bucketName = required("R2_BUCKET_NAME");
  const r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") },
    maxAttempts: 1,
    requestHandler: new NodeHttpHandler({ connectionTimeout: 10_000, requestTimeout: 120_000, socketTimeout: 120_000, throwOnRequestTimeout: true }),
  });
  await mkdir(REPORT_DIRECTORY, { recursive: true });

  const priorReport = JSON.parse(await readFile(`${REPORT_DIRECTORY}/r2-full-migration.json`, "utf8"));
  const priorAssets = (priorReport.assets as PriorAsset[]).filter((asset) => asset.verificationStatus === "VERIFIED");
  const priorByPublicId = new Map(priorAssets.map((asset) => [asset.publicId, asset]));
  if (priorAssets.length !== Number(priorReport.summary.expectedAssets)) throw new Error("Prior full-migration report is not complete; refusing to audit against a partial baseline.");

  let checkpoint = { source: {} as Record<string, BinaryValidation>, r2: {} as Record<string, BinaryValidation> };
  if (process.argv.includes("--resume")) {
    try { checkpoint = JSON.parse(await readFile(CHECKPOINT_PATH, "utf8")); } catch {}
  }
  if (process.argv.includes("--retry-failed")) {
    checkpoint.source = Object.fromEntries(Object.entries(checkpoint.source).filter(([, validation]) => validation.status === "VERIFIED"));
    checkpoint.r2 = Object.fromEntries(Object.entries(checkpoint.r2).filter(([, validation]) => validation.status !== "FAILED"));
  }
  const persistCheckpoint = () => writeJsonAtomic(CHECKPOINT_PATH, { updatedAt: new Date().toISOString(), mode: "READ_ONLY", source: checkpoint.source, r2: checkpoint.r2, safety: { mongoDbWrites: 0, mongoDbDeletes: 0, r2Writes: 0, r2Deletes: 0, cloudinaryWrites: 0, cloudinaryDeletes: 0 } });

  const mongo = new MongoClient(mongoUri, { readPreference: "secondaryPreferred" });
  let database: Awaited<ReturnType<typeof readDatabase>>;
  try { await mongo.connect(); database = await readDatabase(mongo); } finally { await mongo.close(); }
  const cloudinary = await listCloudinaryResources();
  const resources = new Map(cloudinary.resources.map((resource) => [resource.publicId, resource]));

  const classifiedReferences = database.references.map((reference) => ({ ...reference, classification: classifyUrl(reference.imageUrl, r2PublicBaseUrl) }));
  const cloudinaryReferences: Reference[] = [];
  for (const reference of classifiedReferences) {
    const parsed = parseCloudinaryUrl(reference.imageUrl);
    if (parsed) cloudinaryReferences.push({ ...reference, publicId: parsed.publicId });
  }
  const referencesByPublicId = new Map<string, Reference[]>();
  for (const reference of cloudinaryReferences) referencesByPublicId.set(reference.publicId!, [...(referencesByPublicId.get(reference.publicId!) || []), reference]);

  const candidateOwners = new Map<string, Set<string>>();
  for (const [publicId, references] of referencesByPublicId) {
    for (const value of unique(references.map((reference) => reference.r2Image).filter(Boolean))) {
      const key = objectKeyFromR2Url(value, r2PublicBaseUrl);
      if (key) candidateOwners.set(key, new Set([...(candidateOwners.get(key) || []), publicId]));
    }
  }

  let readValidations = 0;
  const validateR2Key = async (key: string, publicUrl: string): Promise<BinaryValidation> => {
    if (checkpoint.r2[key]) return checkpoint.r2[key];
    let lastError = "";
    for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
      try {
        const response = await r2Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
        if (!response.Body) throw new Error("R2 GetObject returned an empty body.");
        const body = await response.Body.transformToByteArray();
        const contentType = clean(response.ContentType).split(";")[0].toLowerCase();
        const publicResponse = await fetch(publicUrl, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(60_000) });
        const publicType = clean(publicResponse.headers.get("content-type")).split(";")[0].toLowerCase();
        const result: BinaryValidation = { status: "VERIFIED", bytes: body.byteLength, sha256: sha256(body), contentType, publicAccessible: publicResponse.ok && publicType.startsWith("image/"), httpStatus: publicResponse.status, error: "" };
        checkpoint.r2[key] = result;
        return result;
      } catch (error: any) {
        const missing = error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey";
        if (missing) {
          const result: BinaryValidation = { status: "MISSING", bytes: 0, sha256: "", contentType: "", error: "R2 object does not exist." };
          checkpoint.r2[key] = result;
          return result;
        }
        lastError = safeError(error);
        if (attempt < MAX_READ_ATTEMPTS) await delay(attempt * 1000);
      }
    }
    const result: BinaryValidation = { status: "FAILED", bytes: 0, sha256: "", contentType: "", error: lastError };
    checkpoint.r2[key] = result;
    return result;
  };

  console.log(`Current inventory: ${database.references.length} image references; ${referencesByPublicId.size} unique Cloudinary public IDs.`);
  console.log(`Cloudinary Admin inventory: ${cloudinary.resources.length} image assets in ${cloudinary.requests} read-only requests.`);

  const priorVerification = await mapWithConcurrency(priorAssets, CONCURRENCY, async (asset, index) => {
    const validation = await validateR2Key(asset.r2ObjectKey, asset.r2PublicUrl || publicUrlForKey(r2PublicBaseUrl, asset.r2ObjectKey));
    const valid = validation.status === "VERIFIED" && validation.bytes === asset.sourceByteSize && validation.sha256 === asset.sourceSha256 && validation.publicAccessible === true;
    readValidations += 1;
    if (readValidations % CHECKPOINT_INTERVAL === 0) { await persistCheckpoint(); console.log(`Verified prior R2 baseline: ${readValidations}/${priorAssets.length}`); }
    return { publicId: asset.publicId, r2ObjectKey: asset.r2ObjectKey, valid, validation, expectedBytes: asset.sourceByteSize, expectedSha256: asset.sourceSha256, index };
  });
  const priorStillValid = new Set(priorVerification.filter((result) => result.valid).map((result) => result.publicId));

  let currentCompleted = 0;
  const assets = await mapWithConcurrency([...referencesByPublicId.entries()].sort(([left], [right]) => left.localeCompare(right)), CONCURRENCY, async ([publicId, references]) => {
    const resource = resources.get(publicId);
    const preferredSourceUrl = resource?.secureUrl || references[0].imageUrl;
    const sourceSignature = `${publicId}|${resource?.version || 0}|${resource?.bytes || 0}|${preferredSourceUrl}`;
    let source = checkpoint.source[sourceSignature];
    if (!source) {
      source = await fetchBytes(preferredSourceUrl);
      checkpoint.source[sourceSignature] = source;
    }
    const format = resource?.format || parseCloudinaryUrl(preferredSourceUrl)?.extension || formatForContentType(source.contentType);
    const deterministicKey = proposedObjectKey(publicId, format);
    const shadowUrls = unique(references.map((reference) => reference.r2Image).filter(Boolean));
    const shadowCandidates = shadowUrls.map((url) => ({ url, key: objectKeyFromR2Url(url, r2PublicBaseUrl) })).filter((candidate): candidate is { url: string; key: string } => Boolean(candidate.key));
    const candidates = new Map<string, { key: string; url: string; origin: string }>();
    candidates.set(deterministicKey, { key: deterministicKey, url: publicUrlForKey(r2PublicBaseUrl, deterministicKey), origin: "DETERMINISTIC_MIGRATION_KEY" });
    for (const candidate of shadowCandidates) candidates.set(candidate.key, { ...candidate, origin: "MONGODB_R2_IMAGE" });
    const candidateResults = [];
    for (const candidate of candidates.values()) {
      const validation = await validateR2Key(candidate.key, candidate.url);
      candidateResults.push({ ...candidate, validation, byteSizeMatches: source.status === "VERIFIED" && validation.status === "VERIFIED" && validation.bytes === source.bytes, hashMatches: source.status === "VERIFIED" && validation.status === "VERIFIED" && validation.sha256 === source.sha256, contentTypeMatches: source.status === "VERIFIED" && validation.status === "VERIFIED" && validation.contentType === source.contentType });
    }
    const matching = candidateResults.filter((candidate) => candidate.byteSizeMatches && candidate.hashMatches && candidate.contentTypeMatches && candidate.validation.publicAccessible === true);
    const existingMismatch = candidateResults.filter((candidate) => candidate.validation.status === "VERIFIED" && (!candidate.byteSizeMatches || !candidate.hashMatches || !candidate.contentTypeMatches));
    const validShadowKeys = unique(shadowCandidates.map((candidate) => candidate.key));
    const sharedCandidate = validShadowKeys.some((key) => (candidateOwners.get(key)?.size || 0) > 1);
    const ambiguous = validShadowKeys.length > 1 || sharedCandidate || shadowUrls.length !== shadowCandidates.length;
    let classification: string;
    if (source.status === "MISSING") classification = "BROKEN_CLOUDINARY";
    else if (source.status === "FAILED") classification = "CLOUDINARY_VALIDATION_ISSUE";
    else if (ambiguous || (matching.length > 0 && existingMismatch.length > 0)) classification = "AMBIGUOUS_MAPPING";
    else if (matching.length > 0) classification = priorByPublicId.has(publicId) ? "PREVIOUSLY_MIGRATED_VERIFIED" : "NEW_ALREADY_PRESENT_R2";
    else if (existingMismatch.length > 0) classification = "R2_MISMATCH";
    else classification = "NEEDS_COPY";
    currentCompleted += 1;
    if (currentCompleted % CHECKPOINT_INTERVAL === 0) { await persistCheckpoint(); console.log(`Validated current Cloudinary/R2 assets: ${currentCompleted}/${referencesByPublicId.size}`); }
    return {
      publicId, classification, previouslyMigrated: priorByPublicId.has(publicId), cloudinaryAdminResourceFound: Boolean(resource), cloudinarySourceUrl: preferredSourceUrl, format, source,
      proposedR2ObjectKey: deterministicKey, proposedR2Url: publicUrlForKey(r2PublicBaseUrl, deterministicKey),
      matchingR2Objects: matching.map((candidate) => ({ objectKey: candidate.key, publicUrl: candidate.url, origin: candidate.origin })),
      r2Candidates: candidateResults, databaseReferenceCount: references.length, references,
      ambiguityReasons: [validShadowKeys.length > 1 ? "MULTIPLE_R2_IMAGE_KEYS_FOR_ONE_CLOUDINARY_ASSET" : "", sharedCandidate ? "ONE_R2_KEY_CLAIMED_BY_MULTIPLE_CLOUDINARY_PUBLIC_IDS" : "", shadowUrls.length !== shadowCandidates.length ? "UNPARSEABLE_OR_NON_R2_R2IMAGE_VALUE" : "", matching.length > 0 && existingMismatch.length > 0 ? "MATCHING_AND_MISMATCHING_R2_COPIES_BOTH_EXIST" : ""].filter(Boolean),
    };
  });
  await persistCheckpoint();

  const count = (classification: string) => assets.filter((asset) => asset.classification === classification).length;
  const newAssets = assets.filter((asset) => !asset.previouslyMigrated);
  const needsCopy = assets.filter((asset) => asset.classification === "NEEDS_COPY");
  const malformedReferences = classifiedReferences.filter((reference) => reference.classification === "MALFORMED_CLOUDINARY" || reference.classification === "MALFORMED_OTHER");
  const directlyR2References = classifiedReferences.filter((reference) => reference.classification === "R2");
  const temporaryBlobReferences = classifiedReferences.filter((reference) => reference.classification === "TEMPORARY_BLOB");
  const otherReferences = classifiedReferences.filter((reference) => reference.classification === "OTHER_HTTP");
  const accountedCloudinaryReferences = assets.reduce((total, asset) => total + asset.databaseReferenceCount, 0);
  const unaccountedReferences = database.references.length - accountedCloudinaryReferences - directlyR2References.length - temporaryBlobReferences.length - malformedReferences.length - otherReferences.length;
  const summary = {
    generatedAt: new Date().toISOString(), mode: "INCREMENTAL_CATCHUP_READ_ONLY_DRY_RUN",
    collectionsAudited: ["savedProducts", "imageCatalogue"],
    currentTotalMongoDbImageReferences: database.references.length,
    currentCloudinaryUrlReferences: cloudinaryReferences.length,
    currentDirectR2ImageReferences: directlyR2References.length,
    currentTemporaryBlobReferences: temporaryBlobReferences.length,
    currentOtherHttpReferences: otherReferences.length,
    currentMalformedReferences: malformedReferences.length,
    currentMissingImageFields: database.missing.length,
    currentUniqueCloudinaryAssetsReferenced: assets.length,
    previousVerifiedMigrationCount: priorAssets.length,
    previousAssetsStillValidInR2: priorStillValid.size,
    previousAssetsNoLongerValidInR2: priorAssets.length - priorStillValid.size,
    newlyDiscoveredCloudinaryAssets: newAssets.length,
    newAssetsAlreadyPresentAndVerifiedInR2: newAssets.filter((asset) => asset.classification === "NEW_ALREADY_PRESENT_R2").length,
    assetsNeedingCloudinaryToR2Copy: needsCopy.length,
    brokenCloudinaryReferences: count("BROKEN_CLOUDINARY"),
    brokenCloudinaryDatabaseReferences: assets.filter((asset) => asset.classification === "BROKEN_CLOUDINARY").reduce((total, asset) => total + asset.databaseReferenceCount, 0),
    cloudinaryNetworkOrApiValidationIssues: count("CLOUDINARY_VALIDATION_ISSUE"),
    missingR2Objects: needsCopy.length,
    r2HashMismatches: assets.filter((asset) => asset.source.status === "VERIFIED" && asset.r2Candidates.some((candidate) => candidate.validation.status === "VERIFIED" && !candidate.hashMatches)).length,
    r2ByteSizeMismatches: assets.filter((asset) => asset.source.status === "VERIFIED" && asset.r2Candidates.some((candidate) => candidate.validation.status === "VERIFIED" && !candidate.byteSizeMatches)).length,
    ambiguousMappings: count("AMBIGUOUS_MAPPING"),
    unaccountedAssets: assets.filter((asset) => !["PREVIOUSLY_MIGRATED_VERIFIED", "NEW_ALREADY_PRESENT_R2", "NEEDS_COPY", "BROKEN_CLOUDINARY", "CLOUDINARY_VALIDATION_ISSUE", "R2_MISMATCH", "AMBIGUOUS_MAPPING"].includes(asset.classification)).length,
    unaccountedReferences,
    estimatedBytesToCopy: needsCopy.reduce((total, asset) => total + asset.source.bytes, 0),
    classificationCounts: Object.fromEntries(unique(assets.map((asset) => asset.classification)).sort().map((classification) => [classification, count(classification)])),
    cloudinaryAdminApiReadRequests: cloudinary.requests,
    safety: { mongoDbWrites: 0, mongoDbDeletes: 0, r2Writes: 0, r2Deletes: 0, cloudinaryWrites: 0, cloudinaryDeletes: 0 },
  };
  const proposedMap = needsCopy.map((asset) => ({ publicId: asset.publicId, cloudinarySourceUrl: asset.cloudinarySourceUrl, sourceByteSize: asset.source.bytes, sourceSha256: asset.source.sha256, sourceContentType: asset.source.contentType, format: asset.format, proposedR2ObjectKey: asset.proposedR2ObjectKey, proposedR2Url: asset.proposedR2Url, databaseReferenceCount: asset.databaseReferenceCount, references: asset.references }));
  await writeJsonAtomic(REPORT_PATH, { summary, currentInventory: { savedProductsDocuments: database.savedProductsCount, imageCatalogueDocuments: database.imageCatalogueCount, missingImageFields: database.missing, malformedReferences, directlyR2References, temporaryBlobReferences, otherReferences }, previousBaselineVerification: priorVerification, assets });
  await writeJsonAtomic(MAP_PATH, { generatedAt: summary.generatedAt, mode: "PROPOSED_INCREMENTAL_COPY_MAP_NOT_EXECUTED", objectKeyStrategy: "migrated/<percent-encoded Cloudinary public ID>.<Cloudinary format>", assets: proposedMap, safety: summary.safety });
  const nextCommand = `node --env-file-if-exists=.env.local --env-file=server/.env --experimental-strip-types scripts/migrate-r2-incremental-assets.ts --map ${MAP_PATH} --execute`;
  await writeFile(SUMMARY_PATH, [
    "INCREMENTAL R2 CATCH-UP DRY-RUN SUMMARY", "",
    `Current total MongoDB image references: ${summary.currentTotalMongoDbImageReferences}`,
    `Current unique Cloudinary assets referenced: ${summary.currentUniqueCloudinaryAssetsReferenced}`,
    `Previous verified migration count: ${summary.previousVerifiedMigrationCount}`,
    `Previous assets still valid in R2: ${summary.previousAssetsStillValidInR2}`,
    `Newly discovered assets since previous migration: ${summary.newlyDiscoveredCloudinaryAssets}`,
    `New assets already present and verified in R2: ${summary.newAssetsAlreadyPresentAndVerifiedInR2}`,
    `Assets needing Cloudinary -> R2 copying: ${summary.assetsNeedingCloudinaryToR2Copy}`,
    `Broken Cloudinary references: ${summary.brokenCloudinaryReferences}`,
    `Cloudinary network/API validation issues: ${summary.cloudinaryNetworkOrApiValidationIssues}`,
    `Missing R2 objects: ${summary.missingR2Objects}`,
    `R2 hash mismatches: ${summary.r2HashMismatches}`,
    `R2 byte-size mismatches: ${summary.r2ByteSizeMismatches}`,
    `Ambiguous mappings: ${summary.ambiguousMappings}`,
    `Unaccounted assets: ${summary.unaccountedAssets}`,
    `Unaccounted references: ${summary.unaccountedReferences}`,
    `Estimated bytes needing copy: ${summary.estimatedBytesToCopy}`,
    `MongoDB writes: ${summary.safety.mongoDbWrites}`,
    `MongoDB deletes: ${summary.safety.mongoDbDeletes}`,
    `R2 writes: ${summary.safety.r2Writes}`,
    `R2 deletes: ${summary.safety.r2Deletes}`,
    `Cloudinary writes/deletes: ${summary.safety.cloudinaryWrites + summary.safety.cloudinaryDeletes}`, "",
    "PROPOSED NEXT COMMAND AFTER EXPLICIT APPROVAL (not run; target script will be safety-reviewed before execution):",
    nextCommand,
  ].join("\n") + "\n", "utf8");
  console.log(await readFile(SUMMARY_PATH, "utf8"));
};

await main();
