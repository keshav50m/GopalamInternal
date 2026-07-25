import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

type AccountResource = {
  publicId: string;
  createdAt: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
  folder: string;
  version: number;
  originalFilename: string;
};

const referencesReport = JSON.parse(
  await readFile(
    "audit-reports/cloudinary-reference-audit.json",
    "utf8"
  )
);
const assetsReport = JSON.parse(
  await readFile("audit-reports/cloudinary-asset-audit.json", "utf8")
);

const referencedPublicIds = new Set<string>(
  (referencesReport.referencedAssets || []).map(
    (asset: { publicId: string }) => asset.publicId
  )
);

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);
const sourceCloudinaryPublicIds = new Set<string>();

const extensionOf = (path: string) => {
  const dotIndex = path.lastIndexOf(".");
  return dotIndex >= 0 ? path.slice(dotIndex) : "";
};

const parsePublicId = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    if (url.hostname.toLowerCase() !== "res.cloudinary.com") return "";

    const segments = url.pathname.split("/").filter(Boolean);
    const uploadIndex = segments.indexOf("upload");
    if (uploadIndex < 0) return "";

    const deliverySegments = segments.slice(uploadIndex + 1);
    const versionIndex = deliverySegments.findIndex((segment) =>
      /^v\d+$/.test(segment)
    );
    const assetSegments =
      versionIndex >= 0
        ? deliverySegments.slice(versionIndex + 1)
        : deliverySegments;
    if (!assetSegments.length) return "";

    const finalSegment = assetSegments.at(-1)!;
    assetSegments[assetSegments.length - 1] = finalSegment.replace(
      /\.[a-zA-Z0-9]+$/,
      ""
    );
    return decodeURIComponent(assetSegments.join("/"));
  } catch {
    return "";
  }
};

const scanDirectory = async (directory: string): Promise<void> => {
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    const entryStat = await stat(path);

    if (entryStat.isDirectory()) {
      await scanDirectory(path);
      continue;
    }

    if (!sourceExtensions.has(extensionOf(path))) continue;

    const content = await readFile(path, "utf8");
    const urls =
      content.match(/https:\/\/res\.cloudinary\.com\/[^\s"'`)]+/g) || [];
    urls.forEach((url) => {
      const publicId = parsePublicId(url);
      if (publicId) sourceCloudinaryPublicIds.add(publicId);
    });
  }
};

await scanDirectory("src");

const resources: AccountResource[] = assetsReport.allResources || [];
const protectedPublicIds = new Set([
  ...referencedPublicIds,
  ...sourceCloudinaryPublicIds,
]);
const linkedResources = resources.filter((resource) =>
  referencedPublicIds.has(resource.publicId)
);
const sourceOnlyResources = resources.filter(
  (resource) =>
    sourceCloudinaryPublicIds.has(resource.publicId) &&
    !referencedPublicIds.has(resource.publicId)
);
const orphanResources = resources.filter(
  (resource) => !protectedPublicIds.has(resource.publicId)
);

const orphanManifest = {
  generatedAt: new Date().toISOString(),
  mode: "dry-run",
  deletionPerformed: false,
  summary: {
    totalCloudinaryResources: resources.length,
    databaseReferencedPublicIds: referencedPublicIds.size,
    databaseReferencedResourcesPresentInCloudinary: linkedResources.length,
    databaseReferencesMissingFromCloudinary:
      referencedPublicIds.size - linkedResources.length,
    sourceReferencedPublicIds: sourceCloudinaryPublicIds.size,
    sourceOnlyProtectedResources: sourceOnlyResources.length,
    orphanResourceCount: orphanResources.length,
    orphanStorageBytes: orphanResources.reduce(
      (sum, resource) => sum + resource.bytes,
      0
    ),
  },
  sourceOnlyProtectedResources: sourceOnlyResources,
  orphanResources,
};

const manifestPath = "audit-reports/cloudinary-orphan-manifest.json";
await writeFile(manifestPath, JSON.stringify(orphanManifest, null, 2), "utf8");
console.log(JSON.stringify(orphanManifest.summary, null, 2));
console.log(`Dry-run orphan manifest written to ${manifestPath}`);
