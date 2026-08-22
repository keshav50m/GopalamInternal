import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

type Reference = { _id: string; barcode: string; itemNo: string; imageUrl: string };
type SafeEntry = {
  publicId: string;
  preferredSourceUrl: string;
  format: string;
  proposedR2ObjectKey: string;
  sourceValidation: { bytesRead: number; sha256: string; contentType: string };
  savedProductReferences: Reference[];
  imageCatalogueReferences: Reference[];
  classification: string;
};
type FinalStatus = "VERIFIED" | "ALREADY_VERIFIED" | "FAILED";
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
  migrationStatus: FinalStatus;
  verificationStatus: "VERIFIED" | "FAILED";
  attemptCount: number;
  objectCreatedThisRun: boolean;
  byteSizeMatches: boolean;
  hashMatches: boolean;
  publicUrlAccessible: boolean;
  failureStage: string;
  error: string;
  verifiedAt: string;
};

const REPORT_DIR = "reports";
const CHECKPOINT_PATH = `${REPORT_DIR}/r2-full-migration-checkpoint.json`;
const REPORT_PATH = `${REPORT_DIR}/r2-full-migration.json`;
const SUMMARY_PATH = `${REPORT_DIR}/r2-full-migration-summary.txt`;
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;
const CONCURRENCY = 4;
const clean = (value: unknown) => String(value ?? "").trim();
const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.replace(/https?:\/\/\S+/g, "[redacted-url]").slice(0, 800);
};
const required = (name: string) => {
  const value = clean(process.env[name]);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};
const publicUrlForKey = (baseUrl: string, key: string) =>
  `${baseUrl.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
const isMissingObjectError = (error: any) =>
  error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey";

const safetyGate = JSON.parse(await readFile(`${REPORT_DIR}/pre-migration-safety-gate.json`, "utf8"));
const canaryReport = JSON.parse(await readFile(`${REPORT_DIR}/r2-canary-migration.json`, "utf8"));
const safeEntries = (safetyGate.entryValidations as SafeEntry[])
  .filter((entry) => entry.classification === "SAFE_TO_MIGRATE")
  .sort((left, right) => left.publicId.localeCompare(right.publicId));
if (safeEntries.length !== 5876) throw new Error(`Safety stop: expected 5876 SAFE_TO_MIGRATE assets, found ${safeEntries.length}.`);
if (new Set(safeEntries.map((entry) => entry.publicId)).size !== safeEntries.length) throw new Error("Safety stop: duplicate public IDs exist in the validated set.");
if (new Set(safeEntries.map((entry) => entry.proposedR2ObjectKey)).size !== safeEntries.length) throw new Error("Safety stop: proposed R2 object-key collision detected.");
const canaryKeys = new Set<string>((canaryReport.summary.createdObjectKeys || []).map(clean));
if (canaryKeys.size !== 10) throw new Error(`Safety stop: expected exactly 10 canary keys, found ${canaryKeys.size}.`);

const bucketName = required("R2_BUCKET_NAME");
const publicBaseUrl = required("R2_PUBLIC_BASE_URL");
const client = new S3Client({
  region: "auto",
  endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") },
});

let previousResults = new Map<string, Result>();
let previousR2Writes = 0;
try {
  const checkpoint = JSON.parse(await readFile(CHECKPOINT_PATH, "utf8"));
  previousResults = new Map((checkpoint.results || []).map((result: Result) => [result.publicId, result]));
  previousR2Writes = Number(checkpoint.r2Writes || 0);
} catch {}

const results = new Map<string, Result>();
for (const entry of safeEntries) {
  const previous = previousResults.get(entry.publicId);
  if (previous && (previous.migrationStatus === "VERIFIED" || previous.migrationStatus === "ALREADY_VERIFIED") && previous.verificationStatus === "VERIFIED") {
    results.set(entry.publicId, previous);
  }
}
let r2Writes = previousR2Writes;
let stopped = false;

const summary = () => {
  const values = [...results.values()];
  const verified = values.filter((result) => result.migrationStatus === "VERIFIED").length;
  const alreadyVerified = values.filter((result) => result.migrationStatus === "ALREADY_VERIFIED").length;
  const failed = values.filter((result) => result.migrationStatus === "FAILED").length;
  const accountedFor = verified + alreadyVerified + failed;
  return {
    generatedAt: new Date().toISOString(),
    mode: "FULL_R2_ASSET_COPY_ONLY",
    expectedAssets: safeEntries.length,
    accountedForAssets: accountedFor,
    verifiedAssets: verified,
    alreadyVerifiedAssets: alreadyVerified,
    failedAssets: failed,
    unaccountedAssets: safeEntries.length - accountedFor,
    hashMatches: values.filter((result) => result.hashMatches).length,
    byteSizeMatches: values.filter((result) => result.byteSizeMatches).length,
    publicUrlsAccessible: values.filter((result) => result.publicUrlAccessible).length,
    databaseReferencesPreservedInMap: safeEntries.reduce((total, entry) => total + entry.savedProductReferences.length + entry.imageCatalogueReferences.length, 0),
    totalSourceBytes: values.reduce((total, result) => total + result.sourceByteSize, 0),
    totalR2Bytes: values.reduce((total, result) => total + result.r2ByteSize, 0),
    r2Writes,
    mongoDbWrites: 0,
    cloudinaryWrites: 0,
    cloudinaryDeletes: 0,
    stopped,
  };
};

const writeJsonAtomic = async (path: string, value: unknown) => {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
};
const writeCheckpoint = async () => {
  const completed = [...results.values()].filter((result) => result.migrationStatus === "VERIFIED");
  const already = [...results.values()].filter((result) => result.migrationStatus === "ALREADY_VERIFIED");
  const failed = [...results.values()].filter((result) => result.migrationStatus === "FAILED");
  const terminalIds = new Set([...completed, ...already].map((result) => result.publicId));
  await writeJsonAtomic(CHECKPOINT_PATH, {
    updatedAt: new Date().toISOString(),
    batchSize: BATCH_SIZE,
    maxAttempts: MAX_ATTEMPTS,
    concurrency: CONCURRENCY,
    r2Writes,
    completedAssets: completed.map((result) => result.publicId),
    verifiedAssets: [...completed, ...already].map((result) => result.publicId),
    failedAssets: failed.map((result) => result.publicId),
    skippedAlreadyVerifiedAssets: already.map((result) => result.publicId),
    remainingAssets: safeEntries.filter((entry) => !terminalIds.has(entry.publicId)).map((entry) => entry.publicId),
    results: [...results.values()].sort((left, right) => left.publicId.localeCompare(right.publicId)),
    safety: { mongoDbWrites: 0, cloudinaryWrites: 0, cloudinaryDeletes: 0 },
  });
};

const verifyR2 = async (entry: SafeEntry, sourceBytes: Uint8Array, sourceHash: string, sourceContentType: string) => {
  const getResponse = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: entry.proposedR2ObjectKey }));
  if (!getResponse.Body) throw new Error("R2 GetObject returned an empty body.");
  const body = await getResponse.Body.transformToByteArray();
  const contentType = clean(getResponse.ContentType).split(";")[0].toLowerCase();
  const bodyHash = sha256(body);
  const publicUrl = publicUrlForKey(publicBaseUrl, entry.proposedR2ObjectKey);
  const publicResponse = await fetch(publicUrl, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(60_000) });
  const publicType = clean(publicResponse.headers.get("content-type")).split(";")[0].toLowerCase();
  return {
    body,
    bodyHash,
    contentType,
    publicUrl,
    publicAccessible: publicResponse.ok && publicType.startsWith("image/"),
    byteSizeMatches: body.byteLength === sourceBytes.byteLength,
    hashMatches: bodyHash === sourceHash,
    contentTypeMatches: contentType === sourceContentType,
  };
};

const migrateEntry = async (entry: SafeEntry): Promise<Result> => {
  const previousAttempts = previousResults.get(entry.publicId)?.attemptCount || 0;
  const base: Result = {
    publicId: entry.publicId,
    cloudinarySourceUrl: entry.preferredSourceUrl,
    r2ObjectKey: entry.proposedR2ObjectKey,
    r2PublicUrl: publicUrlForKey(publicBaseUrl, entry.proposedR2ObjectKey),
    sourceByteSize: 0,
    r2ByteSize: 0,
    sourceSha256: "",
    r2Sha256: "",
    sourceContentType: "",
    r2ContentType: "",
    databaseReferenceCount: entry.savedProductReferences.length + entry.imageCatalogueReferences.length,
    migrationStatus: "FAILED",
    verificationStatus: "FAILED",
    attemptCount: previousAttempts,
    objectCreatedThisRun: false,
    byteSizeMatches: false,
    hashMatches: false,
    publicUrlAccessible: false,
    failureStage: "NOT_STARTED",
    error: "",
    verifiedAt: "",
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = { ...base, attemptCount: previousAttempts + attempt };
    try {
      result.failureStage = "SOURCE_DOWNLOAD";
      const sourceResponse = await fetch(entry.preferredSourceUrl, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
      if (!sourceResponse.ok) throw new Error(`Cloudinary returned HTTP ${sourceResponse.status}.`);
      const sourceContentType = clean(sourceResponse.headers.get("content-type")).split(";")[0].toLowerCase();
      if (!sourceContentType.startsWith("image/")) throw new Error(`Cloudinary Content-Type is not image/*: ${sourceContentType || "missing"}.`);
      const sourceBody = new Uint8Array(await sourceResponse.arrayBuffer());
      const sourceHash = sha256(sourceBody);
      if (!sourceBody.byteLength) throw new Error("Cloudinary source is empty.");
      if (sourceBody.byteLength !== entry.sourceValidation.bytesRead || sourceHash !== entry.sourceValidation.sha256) {
        throw new Error("Cloudinary source differs from the validated safety-gate byte size/hash.");
      }
      result.sourceByteSize = sourceBody.byteLength;
      result.sourceSha256 = sourceHash;
      result.sourceContentType = sourceContentType;

      result.failureStage = "R2_EXISTENCE_CHECK";
      let exists = false;
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: entry.proposedR2ObjectKey }));
        exists = true;
      } catch (error) {
        if (!isMissingObjectError(error)) throw error;
      }

      if (!exists) {
        result.failureStage = "R2_UPLOAD";
        await client.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: entry.proposedR2ObjectKey,
          Body: sourceBody,
          ContentType: sourceContentType,
          Metadata: { "source-sha256": sourceHash, "cloudinary-public-id": encodeURIComponent(entry.publicId) },
          IfNoneMatch: "*",
        }));
        r2Writes += 1;
        result.objectCreatedThisRun = true;
      }

      result.failureStage = "R2_VERIFICATION";
      const verification = await verifyR2(entry, sourceBody, sourceHash, sourceContentType);
      result.r2ByteSize = verification.body.byteLength;
      result.r2Sha256 = verification.bodyHash;
      result.r2ContentType = verification.contentType;
      result.r2PublicUrl = verification.publicUrl;
      result.byteSizeMatches = verification.byteSizeMatches;
      result.hashMatches = verification.hashMatches;
      result.publicUrlAccessible = verification.publicAccessible;
      if (!verification.byteSizeMatches) throw new Error("R2 byte size differs from Cloudinary source.");
      if (!verification.hashMatches) throw new Error("R2 SHA-256 differs from Cloudinary source.");
      if (!verification.contentTypeMatches) throw new Error("R2 Content-Type differs from Cloudinary source.");
      if (!verification.publicAccessible) throw new Error("Public R2 URL is not accessible as image/*.");

      result.objectCreatedThisRun ||= base.objectCreatedThisRun;
      result.migrationStatus = exists && !result.objectCreatedThisRun ? "ALREADY_VERIFIED" : "VERIFIED";
      result.verificationStatus = "VERIFIED";
      result.failureStage = "";
      result.error = "";
      result.verifiedAt = new Date().toISOString();
      return result;
    } catch (error) {
      result.error = safeError(error);
      base.attemptCount = result.attemptCount;
      base.sourceByteSize = result.sourceByteSize;
      base.sourceSha256 = result.sourceSha256;
      base.sourceContentType = result.sourceContentType;
      base.r2ByteSize = result.r2ByteSize;
      base.r2Sha256 = result.r2Sha256;
      base.r2ContentType = result.r2ContentType;
      base.objectCreatedThisRun ||= result.objectCreatedThisRun;
      base.byteSizeMatches = result.byteSizeMatches;
      base.hashMatches = result.hashMatches;
      base.publicUrlAccessible = result.publicUrlAccessible;
      base.failureStage = result.failureStage;
      base.error = result.error;
      if (attempt < MAX_ATTEMPTS) await delay(attempt * 2_000);
    }
  }
  return base;
};

const remaining = safeEntries.filter((entry) => !results.has(entry.publicId));
for (let batchStart = 0; batchStart < remaining.length; batchStart += BATCH_SIZE) {
  const batch = remaining.slice(batchStart, batchStart + BATCH_SIZE);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= batch.length) return;
      const entry = batch[index];
      results.set(entry.publicId, await migrateEntry(entry));
    }
  });
  await Promise.all(workers);
  await writeCheckpoint();
  const progress = summary();
  console.log(`Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(remaining.length / BATCH_SIZE)}: accounted=${progress.accountedForAssets}, verified=${progress.verifiedAssets + progress.alreadyVerifiedAssets}, failed=${progress.failedAssets}, remaining=${progress.unaccountedAssets}`);
}

const finalValues = safeEntries.map((entry) => results.get(entry.publicId)).filter(Boolean) as Result[];
const finalSummary = summary();
stopped = finalSummary.failedAssets > 0 || finalSummary.unaccountedAssets > 0 || finalSummary.hashMatches !== finalSummary.expectedAssets || finalSummary.byteSizeMatches !== finalSummary.expectedAssets || finalSummary.publicUrlsAccessible !== finalSummary.expectedAssets;
const completedSummary = summary();
await writeCheckpoint();
await writeJsonAtomic(REPORT_PATH, { summary: completedSummary, assets: finalValues });
await writeFile(SUMMARY_PATH, [
  "FULL R2 ASSET MIGRATION SUMMARY",
  "",
  `Expected unique assets: ${completedSummary.expectedAssets}`,
  `Already verified from canary/existing: ${completedSummary.alreadyVerifiedAssets}`,
  `New assets uploaded and verified: ${completedSummary.verifiedAssets}`,
  `Total assets verified: ${completedSummary.verifiedAssets + completedSummary.alreadyVerifiedAssets}`,
  `Failed: ${completedSummary.failedAssets}`,
  `Unaccounted: ${completedSummary.unaccountedAssets}`,
  `Hash matches: ${completedSummary.hashMatches}`,
  `Byte-size matches: ${completedSummary.byteSizeMatches}`,
  `Public URLs accessible: ${completedSummary.publicUrlsAccessible}`,
  `Database references preserved in migration map: ${completedSummary.databaseReferencesPreservedInMap}`,
  `Total source bytes: ${completedSummary.totalSourceBytes}`,
  `Total R2 bytes: ${completedSummary.totalR2Bytes}`,
  `MongoDB writes: ${completedSummary.mongoDbWrites}`,
  `Cloudinary writes: ${completedSummary.cloudinaryWrites}`,
  `Cloudinary deletes: ${completedSummary.cloudinaryDeletes}`,
  `R2 writes: ${completedSummary.r2Writes}`,
  "",
  "MongoDB references have NOT been switched.",
  "Cloudinary assets remain untouched.",
  "Application functionality has NOT been intentionally modified.",
].join("\n") + "\n", "utf8");
console.log(await readFile(SUMMARY_PATH, "utf8"));
if (stopped) process.exitCode = 1;
