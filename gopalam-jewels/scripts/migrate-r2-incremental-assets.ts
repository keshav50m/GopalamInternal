import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { MongoClient, type Document } from "mongodb";

type DatabaseReference = {
  collection: "savedProducts" | "imageCatalogue";
  documentId: string;
  field: "image";
  imageUrl: string;
  r2Image: string;
  barcode: string;
  itemNo: string;
  publicId?: string;
};
type CatchupEntry = {
  publicId: string;
  cloudinarySourceUrl: string;
  sourceByteSize: number;
  sourceSha256: string;
  sourceContentType: string;
  format: string;
  proposedR2ObjectKey: string;
  proposedR2Url: string;
  databaseReferenceCount: number;
  references: DatabaseReference[];
};
type FinalStatus = "COPIED_VERIFIED" | "ALREADY_PRESENT_VERIFIED" | "FAILED" | "CONFLICT";
type Result = {
  publicId: string;
  cloudinarySourceUrl: string;
  r2ObjectKey: string;
  r2PublicUrl: string;
  sourceByteSize: number;
  r2ByteSize: number;
  sourceSha256: string;
  r2Sha256: string;
  sourceContentType: string;
  r2ContentType: string;
  databaseReferenceCount: number;
  references: DatabaseReference[];
  barcodes: string[];
  itemNos: string[];
  status: FinalStatus;
  attemptCount: number;
  objectCreatedThisRun: boolean;
  byteSizeMatches: boolean;
  hashMatches: boolean;
  contentTypeMatches: boolean;
  publicUrlAccessible: boolean;
  failureStage: string;
  error: string;
  verifiedAt: string;
};
type VerifiedMapping = {
  publicId: string;
  cloudinarySourceUrl: string;
  r2ObjectKey: string;
  r2PublicUrl: string;
  sourceByteSize: number;
  sourceSha256: string;
  sourceContentType: string;
  verificationOrigin: string;
};

const REPORT_DIRECTORY = "reports";
const INPUT_PATH = `${REPORT_DIRECTORY}/r2-incremental-catchup-map.json`;
const DRY_RUN_PATH = `${REPORT_DIRECTORY}/r2-incremental-catchup-dry-run.json`;
const PRIOR_MIGRATION_PATH = `${REPORT_DIRECTORY}/r2-full-migration.json`;
const CHECKPOINT_PATH = `${REPORT_DIRECTORY}/r2-incremental-catchup-migration-checkpoint.json`;
const REPORT_PATH = `${REPORT_DIRECTORY}/r2-incremental-catchup-migration.json`;
const SUMMARY_PATH = `${REPORT_DIRECTORY}/r2-incremental-catchup-migration-summary.txt`;
const CONSOLIDATED_MAP_PATH = `${REPORT_DIRECTORY}/r2-consolidated-cloudinary-r2-mapping.json`;
const EXPECTED_ASSETS = 2504;
const BATCH_SIZE = 100;
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;
const DATABASE_NAME = process.env.MONGO_DB_NAME?.trim() || "gopalamJewels";
const IMAGE_FORMATS = new Set(["avif", "bmp", "gif", "heic", "heif", "ico", "j2k", "jp2", "jpeg", "jpg", "jxl", "png", "psd", "svg", "tga", "tif", "tiff", "webp"]);

const clean = (value: unknown) => String(value ?? "").trim();
const unique = <T>(values: T[]) => [...new Set(values)];
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const hashBytes = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
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
const isMissingObjectError = (error: any) =>
  error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey";
const isPreconditionError = (error: any) =>
  error?.$metadata?.httpStatusCode === 412 || error?.name === "PreconditionFailed";
const publicUrlForKey = (baseUrl: string, key: string) =>
  `${baseUrl.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;

const fetchSource = async (entry: CatchupEntry) => {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(entry.cloudinarySourceUrl, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`Cloudinary returned HTTP ${response.status}.`);
      const contentType = clean(response.headers.get("content-type")).split(";")[0].toLowerCase();
      if (!contentType.startsWith("image/")) throw new Error(`Cloudinary Content-Type is not image/*: ${contentType || "missing"}.`);
      const body = new Uint8Array(await response.arrayBuffer());
      if (!body.byteLength) throw new Error("Cloudinary source body is empty.");
      return { body, bytes: body.byteLength, sha256: hashBytes(body), contentType, attempts: attempt };
    } catch (error) {
      lastError = safeError(error);
      if (attempt < MAX_ATTEMPTS) await delay(attempt * 2_000);
    }
  }
  throw new Error(lastError || "Cloudinary source validation failed.");
};

const verifyPublicUrl = async (url: string) => {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(60_000), cache: "no-store" });
      const contentType = clean(response.headers.get("content-type")).split(";")[0].toLowerCase();
      if (!response.ok || !contentType.startsWith("image/")) throw new Error(`Public R2 response was HTTP ${response.status} with Content-Type ${contentType || "missing"}.`);
      return true;
    } catch (error) {
      lastError = safeError(error);
      if (attempt < MAX_ATTEMPTS) await delay(attempt * 2_000);
    }
  }
  throw new Error(lastError || "Public R2 verification failed.");
};

const safeDecode = (value: string) => {
  try { return decodeURIComponent(value); } catch { return null; }
};
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
  let assetParts: string[];
  if (versionIndex >= 0) assetParts = delivery.slice(versionIndex + 1);
  else {
    let start = 0;
    while (start < delivery.length - 1 && looksLikeTransformation(delivery[start])) start += 1;
    assetParts = delivery.slice(start);
  }
  const decoded = assetParts.map(safeDecode);
  if (!decoded.length || decoded.some((part) => !part)) return null;
  const publicParts = decoded as string[];
  const last = publicParts.at(-1)!;
  const candidate = last.match(/\.([A-Za-z0-9]+)$/)?.[1].toLowerCase() || "";
  if (IMAGE_FORMATS.has(candidate)) publicParts[publicParts.length - 1] = last.slice(0, -(candidate.length + 1));
  const publicId = publicParts.join("/");
  return publicId && !publicParts.some((part) => part === "." || part === "..") ? { publicId } : null;
};
const objectKeyFromR2Url = (value: string, baseUrl: string) => {
  try {
    const url = new URL(value);
    const base = new URL(baseUrl);
    if (url.hostname.toLowerCase() !== base.hostname.toLowerCase()) return null;
    const basePath = base.pathname.replace(/\/+$/, "");
    if (basePath && !url.pathname.startsWith(`${basePath}/`)) return null;
    const parts = url.pathname.slice(basePath.length).replace(/^\/+/, "").split("/").filter(Boolean).map(safeDecode);
    return parts.length && !parts.some((part) => !part || part === "." || part === "..") ? (parts as string[]).join("/") : null;
  } catch { return null; }
};

const readCurrentReferences = async (mongoUri: string) => {
  const client = new MongoClient(mongoUri, { readPreference: "secondaryPreferred" });
  try {
    await client.connect();
    const db = client.db(DATABASE_NAME);
    const [products, catalogue] = await Promise.all([
      db.collection("savedProducts").find({}, { projection: { barcode: 1, image: 1, r2Image: 1, "data.ITEMNO": 1 } }).toArray(),
      db.collection("imageCatalogue").find({}, { projection: { itemNo: 1, image: 1, r2Image: 1 } }).toArray(),
    ]);
    const references: DatabaseReference[] = [];
    let temporaryBlobReferences = 0;
    let malformedReferences = 0;
    const add = (collection: DatabaseReference["collection"], document: Document, barcode: unknown, itemNo: unknown) => {
      const imageUrl = clean(document.image);
      if (!imageUrl) return;
      if (imageUrl.startsWith("blob:")) { temporaryBlobReferences += 1; return; }
      const parsed = parseCloudinaryUrl(imageUrl);
      if (!parsed) { malformedReferences += 1; return; }
      references.push({ collection, documentId: clean(document._id), field: "image", imageUrl, r2Image: clean(document.r2Image), barcode: clean(barcode), itemNo: clean(itemNo), publicId: parsed.publicId });
    };
    products.forEach((document) => add("savedProducts", document, document.barcode, document.data?.ITEMNO));
    catalogue.forEach((document) => add("imageCatalogue", document, "", document.itemNo));
    return { references, temporaryBlobReferences, malformedReferences };
  } finally { await client.close(); }
};

const main = async () => {
  if (!process.argv.includes("--execute")) throw new Error("Safety stop: this copier requires the explicit --execute flag.");
  const inputText = await readFile(INPUT_PATH, "utf8");
  const inputHash = hashText(inputText);
  const input = JSON.parse(inputText);
  const entries = (input.assets as CatchupEntry[]).sort((left, right) => left.publicId.localeCompare(right.publicId));
  if (input.mode !== "PROPOSED_INCREMENTAL_COPY_MAP_NOT_EXECUTED") throw new Error("Safety stop: input is not the validated incremental dry-run map.");
  if (entries.length !== EXPECTED_ASSETS) throw new Error(`Safety stop: expected exactly ${EXPECTED_ASSETS} map entries, found ${entries.length}.`);
  if (new Set(entries.map((entry) => entry.publicId)).size !== entries.length) throw new Error("Safety stop: duplicate Cloudinary public IDs exist in the map.");
  if (new Set(entries.map((entry) => entry.proposedR2ObjectKey)).size !== entries.length) throw new Error("Safety stop: destination object-key collision exists in the map.");
  if (entries.some((entry) => !entry.sourceSha256 || entry.sourceByteSize <= 0 || !entry.sourceContentType.startsWith("image/") || !entry.proposedR2ObjectKey.startsWith("migrated/"))) throw new Error("Safety stop: the map contains an unvalidated source or incompatible destination key.");

  const bucketName = required("R2_BUCKET_NAME");
  const publicBaseUrl = required("R2_PUBLIC_BASE_URL");
  const mongoUri = required("MONGO_URI");
  const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") },
    maxAttempts: 1,
    requestHandler: new NodeHttpHandler({ connectionTimeout: 10_000, requestTimeout: 120_000, socketTimeout: 120_000, throwOnRequestTimeout: true }),
  });
  await mkdir(REPORT_DIRECTORY, { recursive: true });

  let checkpoint: any = null;
  try { checkpoint = JSON.parse(await readFile(CHECKPOINT_PATH, "utf8")); } catch {}
  if (checkpoint && checkpoint.inputSha256 !== inputHash) throw new Error("Safety stop: checkpoint belongs to a different incremental map.");
  const runId = clean(checkpoint?.runId) || randomUUID();
  const previousResults = new Map<string, Result>((checkpoint?.results || []).map((result: Result) => [result.publicId, result]));
  const results = new Map<string, Result>();
  for (const result of previousResults.values()) if (result.status === "COPIED_VERIFIED" || result.status === "ALREADY_PRESENT_VERIFIED") results.set(result.publicId, result);
  let r2Writes = Number(checkpoint?.r2Writes || 0);

  const summary = () => {
    const values = [...results.values()];
    const copied = values.filter((result) => result.status === "COPIED_VERIFIED").length;
    const already = values.filter((result) => result.status === "ALREADY_PRESENT_VERIFIED").length;
    const failed = values.filter((result) => result.status === "FAILED").length;
    const conflicts = values.filter((result) => result.status === "CONFLICT").length;
    return {
      generatedAt: new Date().toISOString(), mode: "INCREMENTAL_R2_CATCHUP_COPY_ONLY", expectedAssets: entries.length,
      copiedVerified: copied, alreadyPresentVerified: already, failed, conflicts,
      accountedFor: copied + already + failed + conflicts, unaccounted: entries.length - copied - already - failed - conflicts,
      hashMatches: values.filter((result) => result.hashMatches).length,
      byteSizeMatches: values.filter((result) => result.byteSizeMatches).length,
      publicUrlsAccessible: values.filter((result) => result.publicUrlAccessible).length,
      totalBytesCopied: values.filter((result) => result.objectCreatedThisRun).reduce((total, result) => total + result.sourceByteSize, 0),
      r2Writes, mongoDbWrites: 0, mongoDbDeletes: 0, cloudinaryWrites: 0, cloudinaryDeletes: 0, r2Deletes: 0, existingR2ObjectsOverwritten: 0,
    };
  };
  const writeCheckpoint = async () => writeJsonAtomic(CHECKPOINT_PATH, {
    updatedAt: new Date().toISOString(), runId, inputPath: INPUT_PATH, inputSha256: inputHash, batchSize: BATCH_SIZE, concurrency: CONCURRENCY, maxAttempts: MAX_ATTEMPTS,
    ...summary(), completedPublicIds: [...results.values()].filter((result) => result.status === "COPIED_VERIFIED" || result.status === "ALREADY_PRESENT_VERIFIED").map((result) => result.publicId),
    remainingPublicIds: entries.filter((entry) => !results.has(entry.publicId)).map((entry) => entry.publicId),
    results: [...results.values()].sort((left, right) => left.publicId.localeCompare(right.publicId)),
    safety: { mongoDbWrites: 0, mongoDbDeletes: 0, cloudinaryWrites: 0, cloudinaryDeletes: 0, r2Deletes: 0, existingR2ObjectsOverwritten: 0 },
  });

  const verifyR2Object = async (entry: CatchupEntry, source: { body: Uint8Array; bytes: number; sha256: string; contentType: string }) => {
    let lastError = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await r2.send(new GetObjectCommand({ Bucket: bucketName, Key: entry.proposedR2ObjectKey }));
        if (!response.Body) throw new Error("R2 GetObject returned an empty body.");
        const body = await response.Body.transformToByteArray();
        const contentType = clean(response.ContentType).split(";")[0].toLowerCase();
        const r2Hash = hashBytes(body);
        const publicUrl = publicUrlForKey(publicBaseUrl, entry.proposedR2ObjectKey);
        const publicAccessible = await verifyPublicUrl(publicUrl);
        return { bytes: body.byteLength, sha256: r2Hash, contentType, publicUrl, publicAccessible, byteSizeMatches: body.byteLength === source.bytes, hashMatches: r2Hash === source.sha256, contentTypeMatches: contentType === source.contentType };
      } catch (error) {
        lastError = safeError(error);
        if (attempt < MAX_ATTEMPTS) await delay(attempt * 2_000);
      }
    }
    throw new Error(lastError || "R2 verification failed.");
  };
  const headObject = async (key: string) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try { return { exists: true as const, response: await r2.send(new HeadObjectCommand({ Bucket: bucketName, Key: key })) }; }
      catch (error) {
        if (isMissingObjectError(error)) return { exists: false as const, response: null };
        lastError = error;
        if (attempt < MAX_ATTEMPTS) await delay(attempt * 2_000);
      }
    }
    throw lastError;
  };
  const conditionallyCreate = async (entry: CatchupEntry, source: { body: Uint8Array; sha256: string; contentType: string }) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await r2.send(new PutObjectCommand({
          Bucket: bucketName, Key: entry.proposedR2ObjectKey, Body: source.body, ContentType: source.contentType,
          Metadata: { "source-sha256": source.sha256, "cloudinary-public-id": encodeURIComponent(entry.publicId), "migration-run-id": runId }, IfNoneMatch: "*",
        }));
        r2Writes += 1;
        return true;
      } catch (error) {
        if (isPreconditionError(error)) return false;
        lastError = error;
        try {
          const check = await headObject(entry.proposedR2ObjectKey);
          if (check.exists) {
            const createdByThisRun = clean(check.response.Metadata?.["migration-run-id"]) === runId;
            if (createdByThisRun) r2Writes += 1;
            return createdByThisRun;
          }
        } catch {}
        if (attempt < MAX_ATTEMPTS) await delay(attempt * 2_000);
      }
    }
    throw lastError;
  };

  const migrateEntry = async (entry: CatchupEntry): Promise<Result> => {
    const previous = previousResults.get(entry.publicId);
    const base: Result = {
      publicId: entry.publicId, cloudinarySourceUrl: entry.cloudinarySourceUrl, r2ObjectKey: entry.proposedR2ObjectKey,
      r2PublicUrl: publicUrlForKey(publicBaseUrl, entry.proposedR2ObjectKey), sourceByteSize: 0, r2ByteSize: 0,
      sourceSha256: "", r2Sha256: "", sourceContentType: "", r2ContentType: "", databaseReferenceCount: entry.databaseReferenceCount,
      references: entry.references, barcodes: unique(entry.references.map((reference) => reference.barcode).filter(Boolean)), itemNos: unique(entry.references.map((reference) => reference.itemNo).filter(Boolean)),
      status: "FAILED", attemptCount: previous?.attemptCount || 0, objectCreatedThisRun: previous?.objectCreatedThisRun || false,
      byteSizeMatches: false, hashMatches: false, contentTypeMatches: false, publicUrlAccessible: false, failureStage: "NOT_STARTED", error: "", verifiedAt: "",
    };
    try {
      base.failureStage = "SOURCE_DOWNLOAD_AND_VALIDATION";
      const source = await fetchSource(entry);
      base.attemptCount += source.attempts;
      base.sourceByteSize = source.bytes;
      base.sourceSha256 = source.sha256;
      base.sourceContentType = source.contentType;
      if (source.bytes !== entry.sourceByteSize || source.sha256 !== entry.sourceSha256 || source.contentType !== entry.sourceContentType) {
        base.status = "CONFLICT";
        base.error = "Cloudinary source bytes, SHA-256, or Content-Type changed since the validated dry run; destination was not written.";
        return base;
      }

      base.failureStage = "DESTINATION_EXISTENCE_CHECK";
      const initialDestination = await headObject(entry.proposedR2ObjectKey);
      let existedBefore = initialDestination.exists;
      if (initialDestination.exists && clean(initialDestination.response.Metadata?.["migration-run-id"]) === runId) {
        base.objectCreatedThisRun = true;
        if (!previous?.objectCreatedThisRun) r2Writes += 1;
      }

      if (!existedBefore) {
        base.failureStage = "CONDITIONAL_R2_CREATE";
        base.objectCreatedThisRun = await conditionallyCreate(entry, source);
        existedBefore = !base.objectCreatedThisRun;
      }

      base.failureStage = "R2_CONTENT_VERIFICATION";
      const verified = await verifyR2Object(entry, source);
      base.r2ByteSize = verified.bytes;
      base.r2Sha256 = verified.sha256;
      base.r2ContentType = verified.contentType;
      base.r2PublicUrl = verified.publicUrl;
      base.byteSizeMatches = verified.byteSizeMatches;
      base.hashMatches = verified.hashMatches;
      base.contentTypeMatches = verified.contentTypeMatches;
      base.publicUrlAccessible = verified.publicAccessible;
      if (!verified.byteSizeMatches || !verified.hashMatches || !verified.contentTypeMatches) {
        base.status = "CONFLICT";
        base.error = "Existing/created R2 object does not exactly match the validated Cloudinary source; it was not overwritten.";
        return base;
      }
      if (!verified.publicAccessible) throw new Error("R2 public URL is not accessible as image/*.");
      base.status = base.objectCreatedThisRun ? "COPIED_VERIFIED" : "ALREADY_PRESENT_VERIFIED";
      base.failureStage = "";
      base.error = "";
      base.verifiedAt = new Date().toISOString();
      return base;
    } catch (error) {
      base.status = "FAILED";
      base.error = safeError(error);
      return base;
    }
  };

  const remaining = entries.filter((entry) => !results.has(entry.publicId));
  for (let batchStart = 0; batchStart < remaining.length; batchStart += BATCH_SIZE) {
    const batch = remaining.slice(batchStart, batchStart + BATCH_SIZE);
    let next = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= batch.length) return;
        const entry = batch[index];
        results.set(entry.publicId, await migrateEntry(entry));
      }
    });
    await Promise.all(workers);
    await writeCheckpoint();
    const progress = summary();
    console.log(`Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(remaining.length / BATCH_SIZE)}: copied=${progress.copiedVerified}, already=${progress.alreadyPresentVerified}, failed=${progress.failed}, conflicts=${progress.conflicts}, unaccounted=${progress.unaccounted}`);
  }
  await writeCheckpoint();

  const migrationSummary = summary();
  const dryRun = JSON.parse(await readFile(DRY_RUN_PATH, "utf8"));
  const priorMigration = JSON.parse(await readFile(PRIOR_MIGRATION_PATH, "utf8"));
  const verifiedMappings = new Map<string, VerifiedMapping>();
  for (const asset of priorMigration.assets || []) {
    if (asset.verificationStatus !== "VERIFIED") continue;
    verifiedMappings.set(asset.publicId, { publicId: asset.publicId, cloudinarySourceUrl: asset.cloudinarySourceUrl, r2ObjectKey: asset.r2ObjectKey, r2PublicUrl: asset.r2PublicUrl, sourceByteSize: asset.sourceByteSize, sourceSha256: asset.sourceSha256, sourceContentType: asset.sourceContentType, verificationOrigin: "PRIOR_FULL_MIGRATION" });
  }
  for (const asset of dryRun.assets || []) {
    if (asset.classification !== "NEW_ALREADY_PRESENT_R2" || !asset.matchingR2Objects?.length) continue;
    const matching = asset.matchingR2Objects[0];
    verifiedMappings.set(asset.publicId, { publicId: asset.publicId, cloudinarySourceUrl: asset.cloudinarySourceUrl, r2ObjectKey: matching.objectKey, r2PublicUrl: matching.publicUrl, sourceByteSize: asset.source.bytes, sourceSha256: asset.source.sha256, sourceContentType: asset.source.contentType, verificationOrigin: "DUAL_WRITE_DRY_RUN_VERIFIED" });
  }
  for (const result of results.values()) {
    if (result.status !== "COPIED_VERIFIED" && result.status !== "ALREADY_PRESENT_VERIFIED") continue;
    verifiedMappings.set(result.publicId, { publicId: result.publicId, cloudinarySourceUrl: result.cloudinarySourceUrl, r2ObjectKey: result.r2ObjectKey, r2PublicUrl: result.r2PublicUrl, sourceByteSize: result.sourceByteSize, sourceSha256: result.sourceSha256, sourceContentType: result.sourceContentType, verificationOrigin: result.status });
  }

  const current = await readCurrentReferences(mongoUri);
  const currentByPublicId = new Map<string, DatabaseReference[]>();
  for (const reference of current.references) currentByPublicId.set(reference.publicId!, [...(currentByPublicId.get(reference.publicId!) || []), reference]);
  const coverage = await mapWithConcurrency([...currentByPublicId.entries()].sort(([left], [right]) => left.localeCompare(right)), CONCURRENCY, async ([publicId, references]) => {
    let mapping = verifiedMappings.get(publicId);
    let status = mapping ? "VERIFIED_R2_COUNTERPART" : "MISSING_R2_COUNTERPART";
    let error = "";
    if (!mapping) {
      const r2Urls = unique(references.map((reference) => reference.r2Image).filter(Boolean));
      if (r2Urls.length === 1) {
        const key = objectKeyFromR2Url(r2Urls[0], publicBaseUrl);
        if (key) {
          try {
            const sourceEntry: CatchupEntry = { publicId, cloudinarySourceUrl: references[0].imageUrl, sourceByteSize: 0, sourceSha256: "", sourceContentType: "", format: "", proposedR2ObjectKey: key, proposedR2Url: r2Urls[0], databaseReferenceCount: references.length, references };
            const source = await fetchSource(sourceEntry);
            const candidateEntry = { ...sourceEntry, proposedR2ObjectKey: key };
            const verified = await verifyR2Object(candidateEntry, source);
            if (verified.byteSizeMatches && verified.hashMatches && verified.contentTypeMatches && verified.publicAccessible) {
              mapping = { publicId, cloudinarySourceUrl: references[0].imageUrl, r2ObjectKey: key, r2PublicUrl: verified.publicUrl, sourceByteSize: source.bytes, sourceSha256: source.sha256, sourceContentType: source.contentType, verificationOrigin: "POST_MIGRATION_DUAL_WRITE_VERIFIED" };
              verifiedMappings.set(publicId, mapping);
              status = "VERIFIED_R2_COUNTERPART";
            } else { status = "CONFLICT"; error = "Current dual-write object does not match its Cloudinary source."; }
          } catch (validationError) { status = "UNACCOUNTED"; error = safeError(validationError); }
        }
      } else if (r2Urls.length > 1) { status = "UNACCOUNTED"; error = "Multiple R2 shadow URLs map to one Cloudinary public ID."; }
    }
    if (mapping) {
      try {
        const finalHead = await headObject(mapping.r2ObjectKey);
        if (!finalHead.exists) throw Object.assign(new Error("R2 object is missing."), { name: "NoSuchKey" });
        const head = finalHead.response;
        const publicAccessible = await verifyPublicUrl(mapping.r2PublicUrl);
        if (Number(head.ContentLength || 0) !== mapping.sourceByteSize || !publicAccessible) { status = "CONFLICT"; error = "Final R2 existence/byte-size/public-access check failed."; }
      } catch (validationError) { status = isMissingObjectError(validationError) ? "MISSING_R2_COUNTERPART" : "UNACCOUNTED"; error = safeError(validationError); }
    }
    return { publicId, status, error, cloudinarySourceUrls: unique(references.map((reference) => reference.imageUrl)), r2ObjectKey: mapping?.r2ObjectKey || "", r2PublicUrl: mapping?.r2PublicUrl || "", sourceByteSize: mapping?.sourceByteSize || 0, sourceSha256: mapping?.sourceSha256 || "", sourceContentType: mapping?.sourceContentType || "", verificationOrigin: mapping?.verificationOrigin || "", databaseReferenceCount: references.length, references, barcodes: unique(references.map((reference) => reference.barcode).filter(Boolean)), itemNos: unique(references.map((reference) => reference.itemNo).filter(Boolean)) };
  });
  const overall = {
    reconciledAt: new Date().toISOString(), currentCloudinaryReferences: current.references.length, currentUniqueReferencedCloudinaryAssets: coverage.length,
    verifiedR2Counterparts: coverage.filter((entry) => entry.status === "VERIFIED_R2_COUNTERPART").length,
    missingR2Counterparts: coverage.filter((entry) => entry.status === "MISSING_R2_COUNTERPART").length,
    conflicts: coverage.filter((entry) => entry.status === "CONFLICT").length,
    unaccountedAssets: coverage.filter((entry) => entry.status === "UNACCOUNTED").length,
    unaccountedReferences: coverage.filter((entry) => entry.status === "UNACCOUNTED").reduce((total, entry) => total + entry.databaseReferenceCount, 0),
    temporaryBlobReferences: current.temporaryBlobReferences, malformedReferences: current.malformedReferences,
  };
  const consolidated = coverage.filter((entry) => entry.status === "VERIFIED_R2_COUNTERPART").map((entry) => ({ publicId: entry.publicId, cloudinarySourceUrls: entry.cloudinarySourceUrls, preferredCloudinarySourceUrl: entry.cloudinarySourceUrls[0] || "", r2ObjectKey: entry.r2ObjectKey, r2PublicUrl: entry.r2PublicUrl, sourceByteSize: entry.sourceByteSize, sourceSha256: entry.sourceSha256, sourceContentType: entry.sourceContentType, verificationOrigin: entry.verificationOrigin, databaseReferenceCount: entry.databaseReferenceCount, references: entry.references, barcodes: entry.barcodes, itemNos: entry.itemNos }));
  await writeJsonAtomic(CONSOLIDATED_MAP_PATH, { generatedAt: overall.reconciledAt, mode: "VERIFIED_MAPPING_FOR_FUTURE_MONGODB_BACKFILL_NO_DATABASE_WRITES_PERFORMED", summary: overall, assets: consolidated });
  const finalSummary = { ...migrationSummary, overallCoverage: overall, consolidatedMappingPath: CONSOLIDATED_MAP_PATH, temporaryBlobReferencesPreserved: current.temporaryBlobReferences };
  await writeJsonAtomic(REPORT_PATH, { summary: finalSummary, assets: entries.map((entry) => results.get(entry.publicId) || null), overallCoverage: coverage });
  await writeFile(SUMMARY_PATH, [
    "INCREMENTAL R2 CATCH-UP MIGRATION SUMMARY", "",
    `Catch-up assets expected: ${finalSummary.expectedAssets}`,
    `Newly copied and verified: ${finalSummary.copiedVerified}`,
    `Already present and verified: ${finalSummary.alreadyPresentVerified}`,
    `Failed: ${finalSummary.failed}`,
    `Conflicts: ${finalSummary.conflicts}`,
    `Unaccounted: ${finalSummary.unaccounted}`,
    `Hash matches: ${finalSummary.hashMatches}`,
    `Byte-size matches: ${finalSummary.byteSizeMatches}`,
    `Public URLs accessible: ${finalSummary.publicUrlsAccessible}`,
    `Current unique referenced Cloudinary assets: ${overall.currentUniqueReferencedCloudinaryAssets}`,
    `Current verified R2 coverage: ${overall.verifiedR2Counterparts}`,
    `Remaining Cloudinary assets without R2 counterpart: ${overall.missingR2Counterparts}`,
    `Overall conflicts: ${overall.conflicts}`,
    `Overall unaccounted assets: ${overall.unaccountedAssets}`,
    `Overall unaccounted references: ${overall.unaccountedReferences}`,
    `Temporary/blob references preserved: ${overall.temporaryBlobReferences}`,
    `Total bytes copied: ${finalSummary.totalBytesCopied}`,
    `MongoDB writes: ${finalSummary.mongoDbWrites}`,
    `MongoDB deletes: ${finalSummary.mongoDbDeletes}`,
    `Cloudinary writes: ${finalSummary.cloudinaryWrites}`,
    `Cloudinary deletes: ${finalSummary.cloudinaryDeletes}`,
    `R2 writes: ${finalSummary.r2Writes}`,
    `R2 deletes: ${finalSummary.r2Deletes}`,
    `Existing R2 objects overwritten: ${finalSummary.existingR2ObjectsOverwritten}`,
    `Consolidated mapping: ${CONSOLIDATED_MAP_PATH}`, "",
    "MongoDB references have NOT been modified.",
    "Cloudinary remains the primary provider and was not modified.",
  ].join("\n") + "\n", "utf8");
  console.log(await readFile(SUMMARY_PATH, "utf8"));
  if (finalSummary.failed || finalSummary.conflicts || finalSummary.unaccounted || overall.missingR2Counterparts || overall.conflicts || overall.unaccountedAssets) process.exitCode = 1;
};

await main();
