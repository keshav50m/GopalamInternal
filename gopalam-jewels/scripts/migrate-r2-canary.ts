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

type CanaryResult = {
  publicId: string;
  cloudinaryUrl: string;
  r2ObjectKey: string;
  r2Url: string;
  sourceByteSize: number;
  r2ByteSize: number;
  sourceSha256: string;
  r2Sha256: string;
  sourceContentType: string;
  r2ContentType: string;
  mongoDbReferenceCount: number;
  barcodes: string[];
  itemNos: string[];
  objectCreated: boolean;
  publicR2UrlAccessible: boolean;
  byteSizeMatches: boolean;
  hashMatches: boolean;
  status: "VERIFIED" | "FAILED";
  failureReason: string;
};

const clean = (value: unknown) => String(value ?? "").trim();
const unique = <T>(values: T[]) => [...new Set(values)];
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const required = (name: string) => {
  const value = clean(process.env[name]);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};
const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.replace(/https?:\/\/\S+/g, "[redacted-url]").slice(0, 800);
};
const publicUrlForKey = (baseUrl: string, key: string) =>
  `${baseUrl.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;

const safetyGate = JSON.parse(await readFile("reports/pre-migration-safety-gate.json", "utf8"));
const destinationPreflight = JSON.parse(await readFile("reports/r2-destination-preflight.json", "utf8"));
if (destinationPreflight.summary.existingObjectsRequiringIdentityVerification !== 0 || destinationPreflight.summary.unknown !== 0) {
  throw new Error("Canary safety stop: destination preflight is not clean.");
}

const safeEntries = (safetyGate.entryValidations as SafeEntry[]).filter((entry) => entry.classification === "SAFE_TO_MIGRATE");
if (safeEntries.length < 10) throw new Error("Canary safety stop: fewer than 10 SAFE_TO_MIGRATE assets are available.");

const referenceCount = (entry: SafeEntry) => entry.savedProductReferences.length + entry.imageCatalogueReferences.length;
const ordered = [...safeEntries].sort((left, right) => referenceCount(right) - referenceCount(left) || left.publicId.localeCompare(right.publicId));
const selected: SafeEntry[] = [];
const selectedBarcodes = new Set<string>();
const selectedItemNos = new Set<string>();
const tryAdd = (entry: SafeEntry | undefined, requireDiversity = true) => {
  if (!entry || selected.some((candidate) => candidate.publicId === entry.publicId)) return;
  const barcodes = unique(entry.savedProductReferences.map((reference) => clean(reference.barcode)).filter(Boolean));
  const itemNos = unique([...entry.savedProductReferences, ...entry.imageCatalogueReferences].map((reference) => clean(reference.itemNo).toUpperCase()).filter(Boolean));
  const addsDiversity = selected.length === 0 || barcodes.some((value) => !selectedBarcodes.has(value)) || itemNos.some((value) => !selectedItemNos.has(value));
  if (requireDiversity && !addsDiversity) return;
  selected.push(entry);
  barcodes.forEach((value) => selectedBarcodes.add(value));
  itemNos.forEach((value) => selectedItemNos.add(value));
};

tryAdd(ordered[0]);
tryAdd(safeEntries.find((entry) => entry.savedProductReferences.length === 1 && entry.imageCatalogueReferences.length === 0));
tryAdd(safeEntries.find((entry) => entry.savedProductReferences.length === 0 && entry.imageCatalogueReferences.length === 1));
tryAdd(ordered.find((entry) => entry.savedProductReferences.length > 0 && entry.imageCatalogueReferences.length > 0));
for (const entry of [...safeEntries].sort((left, right) => referenceCount(left) - referenceCount(right) || left.publicId.localeCompare(right.publicId))) {
  if (selected.length === 10) break;
  tryAdd(entry);
}
if (selected.length !== 10) throw new Error("Canary safety stop: unable to select exactly 10 diverse assets.");
if (!selected.some((entry) => referenceCount(entry) > 1)) throw new Error("Canary safety stop: selection does not include a shared asset.");

const bucketName = required("R2_BUCKET_NAME");
const publicBaseUrl = required("R2_PUBLIC_BASE_URL");
const client = new S3Client({
  region: "auto",
  endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  },
});

const results: CanaryResult[] = [];
const createdObjectKeys: string[] = [];
let r2Writes = 0;
const reportPath = "reports/r2-canary-migration.json";
const summaryPath = "reports/r2-canary-migration-summary.txt";

const currentSummary = () => ({
  generatedAt: new Date().toISOString(),
  mode: "CANARY_MIGRATION_ONLY",
  selectedAssets: selected.length,
  assetsAttempted: results.length,
  assetsUploaded: results.filter((result) => result.objectCreated).length,
  assetsVerified: results.filter((result) => result.status === "VERIFIED").length,
  assetsFailed: results.filter((result) => result.status === "FAILED").length,
  byteSizeMatches: results.filter((result) => result.byteSizeMatches).length,
  hashMatches: results.filter((result) => result.hashMatches).length,
  publicR2UrlsAccessible: results.filter((result) => result.publicR2UrlAccessible).length,
  mongoDbWrites: 0,
  cloudinaryWritesOrDeletes: 0,
  r2Writes,
  stoppedAfterFailure: results.some((result) => result.status === "FAILED"),
  createdObjectKeys,
});

const writeReports = async () => {
  const summary = currentSummary();
  const temporary = `${reportPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ summary, selection: selected.map((entry) => ({
    publicId: entry.publicId,
    referenceCount: referenceCount(entry),
    barcodes: unique(entry.savedProductReferences.map((reference) => reference.barcode).filter(Boolean)),
    itemNos: unique([...entry.savedProductReferences, ...entry.imageCatalogueReferences].map((reference) => reference.itemNo).filter(Boolean)),
    format: entry.format,
  })), results }, null, 2)}\n`, "utf8");
  await rename(temporary, reportPath);
  await writeFile(summaryPath, [
    "CANARY MIGRATION SUMMARY",
    "",
    `Assets attempted: ${summary.assetsAttempted}`,
    `Assets uploaded: ${summary.assetsUploaded}`,
    `Assets verified: ${summary.assetsVerified}`,
    `Assets failed: ${summary.assetsFailed}`,
    `Byte-size matches: ${summary.byteSizeMatches}`,
    `Hash matches: ${summary.hashMatches}`,
    `Public R2 URLs accessible: ${summary.publicR2UrlsAccessible}`,
    `MongoDB writes: ${summary.mongoDbWrites}`,
    `Cloudinary writes/deletes: ${summary.cloudinaryWritesOrDeletes}`,
    `R2 writes: ${summary.r2Writes}`,
    "",
    "Created R2 objects:",
    ...createdObjectKeys.map((key) => `- ${key}`),
  ].join("\n") + "\n", "utf8");
};

for (const entry of selected) {
  const references = [...entry.savedProductReferences, ...entry.imageCatalogueReferences];
  const barcodes = unique(entry.savedProductReferences.map((reference) => clean(reference.barcode)).filter(Boolean));
  const itemNos = unique(references.map((reference) => clean(reference.itemNo)).filter(Boolean));
  const result: CanaryResult = {
    publicId: entry.publicId,
    cloudinaryUrl: entry.preferredSourceUrl,
    r2ObjectKey: entry.proposedR2ObjectKey,
    r2Url: publicUrlForKey(publicBaseUrl, entry.proposedR2ObjectKey),
    sourceByteSize: 0,
    r2ByteSize: 0,
    sourceSha256: "",
    r2Sha256: "",
    sourceContentType: "",
    r2ContentType: "",
    mongoDbReferenceCount: references.length,
    barcodes,
    itemNos,
    objectCreated: false,
    publicR2UrlAccessible: false,
    byteSizeMatches: false,
    hashMatches: false,
    status: "FAILED",
    failureReason: "Canary verification did not complete.",
  };

  try {
    const sourceResponse = await fetch(entry.preferredSourceUrl, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
    if (!sourceResponse.ok) throw new Error(`Cloudinary source returned HTTP ${sourceResponse.status}.`);
    const sourceContentType = clean(sourceResponse.headers.get("content-type")).split(";")[0].toLowerCase();
    if (!sourceContentType.startsWith("image/")) throw new Error(`Cloudinary source Content-Type is not an image: ${sourceContentType || "missing"}.`);
    const sourceBody = new Uint8Array(await sourceResponse.arrayBuffer());
    const sourceSha256 = hash(sourceBody);
    if (sourceBody.byteLength !== entry.sourceValidation.bytesRead || sourceSha256 !== entry.sourceValidation.sha256) {
      throw new Error("Cloudinary source no longer matches the validated safety-gate byte size/hash.");
    }
    result.sourceByteSize = sourceBody.byteLength;
    result.sourceSha256 = sourceSha256;
    result.sourceContentType = sourceContentType;

    let existing = false;
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: entry.proposedR2ObjectKey }));
      existing = true;
    } catch (error: any) {
      const status = error?.$metadata?.httpStatusCode;
      if (status !== 404 && error?.name !== "NotFound" && error?.name !== "NoSuchKey") throw error;
    }

    if (!existing) {
      await client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: entry.proposedR2ObjectKey,
        Body: sourceBody,
        ContentType: sourceContentType,
        Metadata: { "source-sha256": sourceSha256, "cloudinary-public-id": encodeURIComponent(entry.publicId) },
        IfNoneMatch: "*",
      }));
      r2Writes += 1;
      result.objectCreated = true;
      createdObjectKeys.push(entry.proposedR2ObjectKey);
    }

    const r2Response = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: entry.proposedR2ObjectKey }));
    if (!r2Response.Body) throw new Error("R2 GetObject returned an empty body.");
    const r2Body = await r2Response.Body.transformToByteArray();
    result.r2ByteSize = r2Body.byteLength;
    result.r2Sha256 = hash(r2Body);
    result.r2ContentType = clean(r2Response.ContentType).split(";")[0].toLowerCase();
    result.byteSizeMatches = result.r2ByteSize === result.sourceByteSize;
    result.hashMatches = result.r2Sha256 === result.sourceSha256;

    const publicResponse = await fetch(result.r2Url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(60_000) });
    const publicContentType = clean(publicResponse.headers.get("content-type")).split(";")[0].toLowerCase();
    result.publicR2UrlAccessible = publicResponse.ok && publicContentType.startsWith("image/");
    if (!result.byteSizeMatches) throw new Error("R2 byte size does not match Cloudinary source.");
    if (!result.hashMatches) throw new Error("R2 SHA-256 does not match Cloudinary source.");
    if (result.r2ContentType !== result.sourceContentType) throw new Error("R2 Content-Type does not match Cloudinary source.");
    if (!result.publicR2UrlAccessible) throw new Error(`Public R2 URL verification failed with HTTP ${publicResponse.status}.`);
    result.status = "VERIFIED";
    result.failureReason = "";
  } catch (error) {
    result.status = "FAILED";
    result.failureReason = safeError(error);
  }

  results.push(result);
  await writeReports();
  if (result.status === "FAILED") break;
}

await writeReports();
console.log(await readFile(summaryPath, "utf8"));
if (results.some((result) => result.status === "FAILED")) process.exitCode = 1;
