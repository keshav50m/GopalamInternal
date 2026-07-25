import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";

type CloudinaryResource = {
  asset_id?: string;
  public_id: string;
  format?: string;
  version?: number;
  resource_type?: string;
  type?: string;
  created_at?: string;
  bytes?: number;
  width?: number;
  height?: number;
  folder?: string;
  original_filename?: string;
  etag?: string;
  derived?: Array<{ id?: string; transformation?: string; bytes?: number }>;
};

const require = createRequire(
  new URL("../server/package.json", import.meta.url).pathname
);
const cloudinary = require("cloudinary").v2;

const requiredVariables = ["CLOUD_NAME", "API_KEY", "API_SECRET"] as const;
const missingVariables = requiredVariables.filter(
  (name) => !process.env[name]
);

if (missingVariables.length) {
  throw new Error(
    `Missing required environment variables: ${missingVariables.join(", ")}`
  );
}

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
  secure: true,
});

const groupBy = <T>(values: T[], keyFor: (value: T) => string) => {
  const groups = new Map<string, T[]>();
  values.forEach((value) => {
    const key = keyFor(value);
    const group = groups.get(key) || [];
    group.push(value);
    groups.set(key, group);
  });
  return groups;
};

const compactResource = (resource: CloudinaryResource) => ({
  assetId: resource.asset_id || "",
  publicId: resource.public_id,
  createdAt: resource.created_at || "",
  bytes: resource.bytes || 0,
  width: resource.width || 0,
  height: resource.height || 0,
  format: resource.format || "",
  folder:
    resource.folder ||
    resource.public_id.split("/").slice(0, -1).join("/"),
  version: resource.version || 0,
  originalFilename: resource.original_filename || "",
  etag: resource.etag || "",
  derivedAssetCount: resource.derived?.length || 0,
  derivedBytes:
    resource.derived?.reduce((sum, derived) => sum + (derived.bytes || 0), 0) ||
    0,
});

const resources: CloudinaryResource[] = [];
let nextCursor: string | undefined;
let adminResourceRequests = 0;

try {
  do {
    const response = await cloudinary.api.resources({
      resource_type: "image",
      type: "upload",
      max_results: 500,
      next_cursor: nextCursor,
      derived: true,
      direction: "desc",
    });

    adminResourceRequests += 1;
    resources.push(...(response.resources || []));
    nextCursor = response.next_cursor;
  } while (nextCursor);
} catch (error) {
  const safeMessage =
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    typeof error.error === "object" &&
    error.error !== null &&
    "message" in error.error
      ? String(error.error.message)
      : error instanceof Error
        ? error.message
        : "Cloudinary Admin API request failed";

  throw new Error(`Cloudinary Admin API request failed: ${safeMessage}`);
}

let usage: Record<string, unknown> | null = null;
let usageRequestError = "";
try {
  usage = await cloudinary.api.usage();
} catch (error) {
  usageRequestError =
    error instanceof Error ? error.message : "Usage API request failed";
}

const compactResources = resources.map(compactResource);
const byFolder = groupBy(compactResources, (resource) => resource.folder || "(root)");
const byUploadDate = groupBy(
  compactResources,
  (resource) => resource.createdAt.slice(0, 10) || "(unknown)"
);
const byEtag = groupBy(
  compactResources.filter((resource) => resource.etag),
  (resource) => resource.etag
);
const byMetadataSignature = groupBy(
  compactResources,
  (resource) =>
    `${resource.bytes}|${resource.width}|${resource.height}|${resource.format}`
);
const byFilenameStem = groupBy(compactResources, (resource) =>
  (resource.originalFilename || resource.publicId.split("/").at(-1) || "")
    .replace(/[-_](?:copy|\d+)$/i, "")
    .toLowerCase()
);

const exactContentGroups = [...byEtag.values()]
  .filter((group) => group.length > 1)
  .sort((a, b) => b.length - a.length);
const metadataDuplicateGroups = [...byMetadataSignature.values()]
  .filter((group) => group.length > 1)
  .sort((a, b) => b.length - a.length);
const suspiciousFilenameGroups = [...byFilenameStem.values()]
  .filter((group) => group.length > 1)
  .sort((a, b) => b.length - a.length);

const folderCounts = [...byFolder.entries()]
  .map(([folder, group]) => ({ folder, resourceCount: group.length }))
  .sort((a, b) => b.resourceCount - a.resourceCount);
const uploadDateCounts = [...byUploadDate.entries()]
  .map(([date, group]) => ({
    date,
    resourceCount: group.length,
    totalBytes: group.reduce((sum, resource) => sum + resource.bytes, 0),
  }))
  .sort((a, b) => b.date.localeCompare(a.date));

const report = {
  generatedAt: new Date().toISOString(),
  requestSummary: {
    adminResourceRequests,
    usageRequests: usage ? 1 : 0,
    assetDownloads: 0,
    transformationsGenerated: 0,
  },
  summary: {
    totalImageResources: compactResources.length,
    totalStorageBytes: compactResources.reduce(
      (sum, resource) => sum + resource.bytes,
      0
    ),
    totalDerivedResources: compactResources.reduce(
      (sum, resource) => sum + resource.derivedAssetCount,
      0
    ),
    totalDerivedBytes: compactResources.reduce(
      (sum, resource) => sum + resource.derivedBytes,
      0
    ),
    exactContentDuplicateGroupsUsingEtag: exactContentGroups.length,
    metadataDuplicateGroups: metadataDuplicateGroups.length,
    suspiciousFilenameGroups: suspiciousFilenameGroups.length,
  },
  usage,
  usageRequestError,
  folderCounts,
  uploadDateCounts,
  exactContentDuplicateGroups: exactContentGroups,
  metadataDuplicateGroups: metadataDuplicateGroups.slice(0, 200),
  suspiciousFilenameGroups: suspiciousFilenameGroups.slice(0, 200),
  recentlyUploadedAssets: compactResources.slice(0, 200),
  allResources: compactResources,
};

await mkdir("audit-reports", { recursive: true });
const reportPath = "audit-reports/cloudinary-asset-audit.json";
await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log(JSON.stringify({
  ...report.summary,
  ...report.requestSummary,
  usageRequestAvailable: Boolean(usage),
}, null, 2));
console.log(`Read-only report written to ${reportPath}`);
