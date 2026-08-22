import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { MongoClient, type Document } from "mongodb";

type CollectionName = "savedProducts" | "imageCatalogue";

type ParsedCloudinaryUrl = {
  rawUrl: string;
  cloudName: string;
  resourceType: string;
  deliveryType: string;
  transformationSegments: string[];
  transformation: string;
  version: string;
  publicId: string;
  extension: string;
  queryString: string;
  normalizedAssetIdentity: string;
};

type Reference = {
  collection: CollectionName;
  documentId: string;
  barcode: string;
  itemNo: string;
  normalizedItemNo: string;
  imageUrl: string;
};

type ParsedReference = Reference & { parsed: ParsedCloudinaryUrl };

type CloudinaryResource = {
  asset_id?: string;
  public_id: string;
  secure_url?: string;
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
  created_at?: string;
  version?: number;
  folder?: string;
  resource_type?: string;
  type?: string;
  derived?: unknown[];
};

type CompactResource = {
  assetId: string;
  publicId: string;
  secureUrl: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  createdAt: string;
  version: number;
  folder: string;
  resourceType: string;
  deliveryType: string;
  derivedCount: number;
};

const CLOUDINARY_HOST = "res.cloudinary.com";
const DEFAULT_DATABASE = "gopalamJewels";
const REPORT_DIRECTORY = "reports";
const IMAGE_FORMATS = new Set([
  "avif", "bmp", "gif", "heic", "heif", "ico", "j2k", "jp2", "jpeg",
  "jpg", "jxl", "png", "psd", "svg", "tga", "tif", "tiff", "webp",
]);

const clean = (value: unknown) => String(value ?? "").trim();
const normalizeItemNo = (value: unknown) => clean(value).toUpperCase();
const normalizeBarcode = (value: unknown) => clean(value);
const unique = <T>(values: T[]) => [...new Set(values)];
const sumBytes = (values: Array<{ bytes: number }>) =>
  values.reduce((total, value) => total + value.bytes, 0);
const byteSummary = (bytes: number) => ({
  bytes,
  megabytes: Number((bytes / 1024 ** 2).toFixed(2)),
  gigabytes: Number((bytes / 1024 ** 3).toFixed(3)),
});

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const looksLikeTransformationSegment = (segment: string) => {
  if (/^s--[^/]+--$/.test(segment)) return true;
  if (/^t_[^/]+$/.test(segment)) return true;
  if (/^(?:if_|if_else$|if_end$)/.test(segment)) return true;
  return segment.split(",").every((component) =>
    /^(?:a|ac|af|ar|b|bo|br|c|co|cs|d|dl|dn|dpr|du|e|eo|f|fl|fn|fps|g|h|ki|l|o|p|pg|q|r|so|sp|t|u|vc|vs|w|x|y|z)_.+/.test(component)
  );
};

export const parseCloudinaryUrl = (input: unknown): ParsedCloudinaryUrl | null => {
  const rawUrl = clean(input);
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname.toLowerCase() !== CLOUDINARY_HOST) return null;

  const encodedSegments = url.pathname.split("/").filter(Boolean);
  if (encodedSegments.length < 4) return null;
  const [encodedCloudName, encodedResourceType, encodedDeliveryType, ...deliverySegments] =
    encodedSegments;
  const cloudName = safeDecode(encodedCloudName);
  const resourceType = safeDecode(encodedResourceType);
  const deliveryType = safeDecode(encodedDeliveryType);
  if (!cloudName || !resourceType || !deliveryType) return null;

  const versionIndex = deliverySegments.findIndex((segment) => /^v\d+$/.test(segment));
  let transformationSegments: string[];
  let encodedAssetSegments: string[];
  let version = "";

  if (versionIndex >= 0) {
    transformationSegments = deliverySegments.slice(0, versionIndex);
    version = deliverySegments[versionIndex];
    encodedAssetSegments = deliverySegments.slice(versionIndex + 1);
  } else {
    let assetStart = 0;
    while (
      assetStart < deliverySegments.length - 1 &&
      looksLikeTransformationSegment(deliverySegments[assetStart])
    ) {
      assetStart += 1;
    }
    transformationSegments = deliverySegments.slice(0, assetStart);
    encodedAssetSegments = deliverySegments.slice(assetStart);
  }

  if (!encodedAssetSegments.length || transformationSegments.some((part) => !safeDecode(part))) {
    return null;
  }
  const decodedAssetSegments = encodedAssetSegments.map(safeDecode);
  if (decodedAssetSegments.some((part) => part === null || part === "")) return null;

  const assetSegments = decodedAssetSegments as string[];
  const lastSegment = assetSegments.at(-1)!;
  const extensionMatch = lastSegment.match(/\.([A-Za-z0-9]+)$/);
  const possibleExtension = extensionMatch?.[1].toLowerCase() || "";
  const extension = IMAGE_FORMATS.has(possibleExtension) ? possibleExtension : "";
  if (extension) assetSegments[assetSegments.length - 1] = lastSegment.slice(0, -(extension.length + 1));
  const publicId = assetSegments.join("/");
  if (!publicId || publicId.split("/").some((part) => part === "." || part === "..")) return null;

  return {
    rawUrl,
    cloudName,
    resourceType,
    deliveryType,
    transformationSegments: transformationSegments.map((part) => safeDecode(part)!),
    transformation: transformationSegments.map((part) => safeDecode(part)!).join("/"),
    version,
    publicId,
    extension,
    queryString: url.search,
    normalizedAssetIdentity: `${cloudName}/${resourceType}/${deliveryType}/${publicId}`,
  };
};

const groupBy = <T>(values: T[], keyFor: (value: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    groups.set(key, [...(groups.get(key) || []), value]);
  }
  return groups;
};

const isCloudinaryHost = (input: string) => {
  try {
    return new URL(input).hostname.toLowerCase() === CLOUDINARY_HOST;
  } catch {
    return /(?:^|\/)res\.cloudinary\.com(?:\/|$)/i.test(input);
  }
};

const isR2Url = (input: string, publicBaseUrl: string) => {
  try {
    const url = new URL(input);
    if (publicBaseUrl) {
      const base = new URL(publicBaseUrl);
      if (url.hostname.toLowerCase() === base.hostname.toLowerCase()) return true;
    }
    return /\.r2\.dev$/i.test(url.hostname) || /\.r2\.cloudflarestorage\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
};

const isNonDurableBlobUrl = (input: string) => {
  try {
    return new URL(input).protocol === "blob:";
  } catch {
    return false;
  }
};

const isValidHttpUrl = (input: string) => {
  try {
    const protocol = new URL(input).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

const referenceForReport = (reference: Reference) => ({
  _id: reference.documentId,
  barcode: reference.barcode,
  itemNo: reference.itemNo,
  normalizedItemNo: reference.normalizedItemNo,
  imageUrl: reference.imageUrl,
});

const compactResource = (resource: CloudinaryResource): CompactResource => ({
  assetId: clean(resource.asset_id),
  publicId: clean(resource.public_id),
  secureUrl: clean(resource.secure_url),
  format: clean(resource.format).toLowerCase(),
  bytes: Number(resource.bytes || 0),
  width: Number(resource.width || 0),
  height: Number(resource.height || 0),
  createdAt: clean(resource.created_at),
  version: Number(resource.version || 0),
  folder: clean(resource.folder) || clean(resource.public_id).split("/").slice(0, -1).join("/"),
  resourceType: clean(resource.resource_type) || "image",
  deliveryType: clean(resource.type) || "upload",
  derivedCount: Array.isArray(resource.derived) ? resource.derived.length : 0,
});

const proposedObjectKey = (publicId: string, format: string) => {
  const encodedPath = publicId.split("/").map((part) => encodeURIComponent(part)).join("/");
  const safeFormat = /^[a-z0-9]+$/i.test(format) ? format.toLowerCase() : "bin";
  return `migrated/${encodedPath}.${safeFormat}`;
};

const proposedPublicUrl = (baseUrl: string, objectKey: string) => {
  if (!baseUrl) return "";
  return `${baseUrl.replace(/\/+$/, "")}/${objectKey}`;
};

const choosePreferredUrl = (references: ParsedReference[], resource?: CompactResource) => {
  if (resource?.secureUrl) return resource.secureUrl;
  return unique(references.map((reference) => reference.imageUrl)).sort((left, right) => {
    const leftParsed = parseCloudinaryUrl(left)!;
    const rightParsed = parseCloudinaryUrl(right)!;
    const leftScore = Number(Boolean(leftParsed.transformation)) + Number(Boolean(leftParsed.queryString));
    const rightScore = Number(Boolean(rightParsed.transformation)) + Number(Boolean(rightParsed.queryString));
    return leftScore - rightScore || left.length - right.length;
  })[0] || "";
};

const safeErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message.replace(/https?:\/\/[^\s]+/g, "[redacted-url]");
  return "Unknown error";
};

const listCloudinaryResources = async () => {
  const cloudName = clean(process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME);
  const apiKey = clean(process.env.CLOUDINARY_API_KEY || process.env.API_KEY);
  const apiSecret = clean(process.env.CLOUDINARY_API_SECRET || process.env.API_SECRET);
  if (!cloudName || !apiKey || !apiSecret) {
    return { available: false, resources: [] as CompactResource[], requests: 0, reason: "Cloudinary Admin API credentials are not all available." };
  }

  const require = createRequire(new URL("../server/package.json", import.meta.url).pathname);
  const cloudinary = require("cloudinary").v2;
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  const resources: CompactResource[] = [];
  let nextCursor: string | undefined;
  let requests = 0;
  do {
    const response = await cloudinary.api.resources({
      resource_type: "image",
      type: "upload",
      max_results: 500,
      next_cursor: nextCursor,
      derived: true,
    });
    requests += 1;
    resources.push(...(response.resources || []).map(compactResource));
    nextCursor = response.next_cursor;
  } while (nextCursor);
  return { available: true, resources, requests, reason: "" };
};

export const runParserSelfTests = () => {
  const cases = [
    ["https://res.cloudinary.com/demo/image/upload/v123/folder/item.jpg", "folder/item"],
    ["https://res.cloudinary.com/demo/image/upload/w_500/v123/folder/item.jpg", "folder/item"],
    ["https://res.cloudinary.com/demo/image/upload/q_auto,f_auto/v999/folder/item.webp?x=1", "folder/item"],
    ["https://res.cloudinary.com/demo/image/upload/v123/folder/subfolder/item.jpeg", "folder/subfolder/item"],
  ] as const;
  for (const [url, expected] of cases) {
    const actual = parseCloudinaryUrl(url)?.publicId;
    if (actual !== expected) throw new Error(`Parser self-test failed: expected ${expected}, received ${actual || "null"}`);
  }
  const identities = cases.slice(0, 3).map(([url]) => parseCloudinaryUrl(url)?.normalizedAssetIdentity);
  if (new Set(identities).size !== 1) throw new Error("Transformed/versioned URLs did not normalize to one identity.");
  for (const malformed of ["not a url", "https://example.com/a.jpg", "https://res.cloudinary.com/demo/image/upload/v123/"]) {
    if (parseCloudinaryUrl(malformed)) throw new Error(`Malformed URL was parsed unexpectedly: ${malformed}`);
  }
};

const readReferences = async (client: MongoClient) => {
  const databaseName = clean(process.env.MONGO_DB_NAME) || DEFAULT_DATABASE;
  const db = client.db(databaseName);
  const [savedProducts, imageCatalogue] = await Promise.all([
    db.collection("savedProducts").find({}, { projection: { barcode: 1, image: 1, "data.ITEMNO": 1 } }).toArray(),
    db.collection("imageCatalogue").find({}, { projection: { itemNo: 1, image: 1 } }).toArray(),
  ]);
  const references: Reference[] = [];
  const emptyReferences: Array<Omit<Reference, "imageUrl">> = [];
  const add = (collection: CollectionName, document: Document, itemNoValue: unknown, barcodeValue: unknown) => {
    const base = {
      collection,
      documentId: clean(document._id),
      barcode: normalizeBarcode(barcodeValue),
      itemNo: clean(itemNoValue),
      normalizedItemNo: normalizeItemNo(itemNoValue),
    };
    const imageUrl = clean(document.image);
    if (imageUrl) references.push({ ...base, imageUrl });
    else emptyReferences.push(base);
  };
  savedProducts.forEach((document) => add("savedProducts", document, document.data?.ITEMNO, document.barcode));
  imageCatalogue.forEach((document) => add("imageCatalogue", document, document.itemNo, ""));
  return { databaseName, savedProducts, imageCatalogue, references, emptyReferences };
};

const main = async () => {
  runParserSelfTests();
  const mongoUri = clean(process.env.MONGO_URI);
  if (!mongoUri) throw new Error("MONGO_URI is required. Its value is never logged.");
  const r2PublicBaseUrl = clean(process.env.R2_PUBLIC_BASE_URL);
  const client = new MongoClient(mongoUri, { readPreference: "secondaryPreferred" });

  try {
    await client.connect();
    const database = await readReferences(client);
    const parsedCloudinary: ParsedReference[] = [];
    const malformedCloudinary: Reference[] = [];
    const r2References: Reference[] = [];
    const nonDurableBlobReferences: Reference[] = [];
    const malformedOtherReferences: Reference[] = [];
    const otherReferences: Reference[] = [];
    for (const reference of database.references) {
      const parsed = parseCloudinaryUrl(reference.imageUrl);
      if (parsed) parsedCloudinary.push({ ...reference, parsed });
      else if (isCloudinaryHost(reference.imageUrl)) malformedCloudinary.push(reference);
      else if (isR2Url(reference.imageUrl, r2PublicBaseUrl)) r2References.push(reference);
      else if (isNonDurableBlobUrl(reference.imageUrl)) nonDurableBlobReferences.push(reference);
      else if (!isValidHttpUrl(reference.imageUrl)) malformedOtherReferences.push(reference);
      else otherReferences.push(reference);
    }

    let cloudinaryResult: Awaited<ReturnType<typeof listCloudinaryResources>>;
    try {
      cloudinaryResult = await listCloudinaryResources();
    } catch (error) {
      cloudinaryResult = { available: false, resources: [], requests: 0, reason: safeErrorMessage(error) };
    }

    const byPublicId = groupBy(parsedCloudinary, (reference) => reference.parsed.publicId);
    const byExactUrl = groupBy(parsedCloudinary, (reference) => reference.imageUrl);
    const resourceByPublicId = new Map(cloudinaryResult.resources.map((resource) => [resource.publicId, resource]));
    const referencedPresent = [...byPublicId.keys()].filter((publicId) => resourceByPublicId.has(publicId));
    const brokenPublicIds = cloudinaryResult.available
      ? [...byPublicId.keys()].filter((publicId) => !resourceByPublicId.has(publicId))
      : [];
    const orphanResources = cloudinaryResult.available
      ? cloudinaryResult.resources.filter((resource) => !byPublicId.has(resource.publicId))
      : [];

    const sharedAssets = [...byPublicId.entries()].map(([publicId, refs]) => ({
      publicId,
      referenceCount: refs.length,
      barcodes: unique(refs.map((ref) => ref.barcode).filter(Boolean)),
      itemNos: unique(refs.map((ref) => ref.itemNo).filter(Boolean)),
      savedProductsReferenceCount: refs.filter((ref) => ref.collection === "savedProducts").length,
      imageCatalogueReferenceCount: refs.filter((ref) => ref.collection === "imageCatalogue").length,
    })).filter((asset) => asset.barcodes.length > 1 || asset.itemNos.length > 1);

    const itemNoGroups = groupBy(parsedCloudinary.filter((ref) => ref.normalizedItemNo), (ref) => ref.normalizedItemNo);
    const conflictingItemNos = [...itemNoGroups.entries()].map(([itemNo, refs]) => ({
      itemNo,
      displayItemNos: unique(refs.map((ref) => ref.itemNo)),
      publicIds: unique(refs.map((ref) => ref.parsed.publicId)),
      barcodes: unique(refs.map((ref) => ref.barcode).filter(Boolean)),
      urls: unique(refs.map((ref) => ref.imageUrl)),
      references: refs.map(referenceForReport),
    })).filter((conflict) => conflict.publicIds.length > 1);

    const duplicateExactUrls = [...byExactUrl.entries()].filter(([, refs]) => refs.length > 1).map(([url, refs]) => ({
      url,
      referenceCount: refs.length,
      references: refs.map(referenceForReport),
    }));
    const multipleUrlForms = [...byPublicId.entries()].map(([publicId, refs]) => ({
      publicId,
      urls: unique(refs.map((ref) => ref.imageUrl)),
      transformations: unique(refs.map((ref) => ref.parsed.transformation)),
      versions: unique(refs.map((ref) => ref.parsed.version)),
      extensions: unique(refs.map((ref) => ref.parsed.extension)),
    })).filter((entry) => entry.urls.length > 1);

    const migrationMap = [...byPublicId.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([publicId, refs]) => {
      const resource = resourceByPublicId.get(publicId);
      const format = resource?.format || refs.map((ref) => ref.parsed.extension).find(Boolean) || "";
      const objectKey = proposedObjectKey(publicId, format);
      return {
        publicId,
        sourceUrls: unique(refs.map((ref) => ref.imageUrl)),
        preferredSourceUrl: choosePreferredUrl(refs, resource),
        format,
        bytes: resource?.bytes ?? null,
        width: resource?.width ?? null,
        height: resource?.height ?? null,
        createdAt: resource?.createdAt || "",
        savedProductReferences: refs.filter((ref) => ref.collection === "savedProducts").map(referenceForReport),
        imageCatalogueReferences: refs.filter((ref) => ref.collection === "imageCatalogue").map(referenceForReport),
        proposedR2ObjectKey: objectKey,
        proposedR2Url: proposedPublicUrl(r2PublicBaseUrl, objectKey),
        cloudinaryAssetFound: cloudinaryResult.available ? Boolean(resource) : null,
      };
    });

    const referencedResources = referencedPresent.map((id) => resourceByPublicId.get(id)!);
    const summary = {
      generatedAt: new Date().toISOString(),
      mode: "read-only",
      cloudinaryAdminApiAvailable: cloudinaryResult.available,
      cloudinaryAdminApiUnavailableReason: cloudinaryResult.reason,
      cloudinaryAdminApiRequests: cloudinaryResult.requests,
      cloudinaryAssetsInAccount: cloudinaryResult.available ? cloudinaryResult.resources.length : null,
      savedProductsDocuments: database.savedProducts.length,
      imageCatalogueDocuments: database.imageCatalogue.length,
      savedProductsImageReferences: database.references.filter((ref) => ref.collection === "savedProducts").length,
      imageCatalogueImageReferences: database.references.filter((ref) => ref.collection === "imageCatalogue").length,
      savedProductsCloudinaryReferences: parsedCloudinary.filter((ref) => ref.collection === "savedProducts").length,
      imageCatalogueCloudinaryReferences: parsedCloudinary.filter((ref) => ref.collection === "imageCatalogue").length,
      totalCloudinaryUrlReferencesInMongoDb: parsedCloudinary.length,
      uniqueExactCloudinaryUrls: byExactUrl.size,
      uniqueNormalizedCloudinaryPublicIds: byPublicId.size,
      referencedCloudinaryAssetsFound: cloudinaryResult.available ? referencedPresent.length : null,
      orphanCandidateAssets: cloudinaryResult.available ? orphanResources.length : null,
      brokenCloudinaryPublicIds: cloudinaryResult.available ? brokenPublicIds.length : null,
      malformedCloudinaryReferences: malformedCloudinary.length,
      nonDurableBlobReferences: nonDurableBlobReferences.length,
      malformedOtherUrlReferences: malformedOtherReferences.length,
      brokenOrMalformedDatabaseUrlReferences:
        brokenPublicIds.length + malformedCloudinary.length + nonDurableBlobReferences.length + malformedOtherReferences.length,
      sharedAssets: sharedAssets.length,
      conflictingItemNos: conflictingItemNos.length,
      duplicateExactUrlGroups: duplicateExactUrls.length,
      multipleUrlFormsOfSameAsset: multipleUrlForms.length,
      existingR2UrlReferences: r2References.length,
      otherNonCloudinaryUrlReferences: otherReferences.length,
      emptyImageFields: database.emptyReferences.length,
      proposedMigrationAssets: migrationMap.length,
      storage: {
        allCloudinaryAssets: byteSummary(sumBytes(cloudinaryResult.resources)),
        referencedAssets: byteSummary(sumBytes(referencedResources)),
        orphanCandidates: byteSummary(sumBytes(orphanResources)),
      },
      safety: { mongoDbWrites: 0, r2Writes: 0, cloudinaryWritesOrDeletes: 0, imageBinaryDownloads: 0 },
    };

    const brokenReport = {
      generatedAt: summary.generatedAt,
      cloudinaryAdminApiAvailable: cloudinaryResult.available,
      brokenPublicIds: brokenPublicIds.map((publicId) => ({
        publicId,
        references: byPublicId.get(publicId)!.map(referenceForReport),
      })),
      malformedCloudinaryUrls: malformedCloudinary.map(referenceForReport),
      nonDurableBlobUrls: nonDurableBlobReferences.map(referenceForReport),
      malformedOtherUrls: malformedOtherReferences.map(referenceForReport),
    };
    const auditReport = {
      summary,
      classifications: {
        emptyImageFields: database.emptyReferences,
        r2References: r2References.map(referenceForReport),
        nonDurableBlobReferences: nonDurableBlobReferences.map(referenceForReport),
        malformedOtherReferences: malformedOtherReferences.map(referenceForReport),
        otherNonCloudinaryReferences: otherReferences.map(referenceForReport),
      },
      sharedAssets,
      duplicateExactUrls,
      multipleUrlFormsOfSameAsset: multipleUrlForms,
    };

    await mkdir(REPORT_DIRECTORY, { recursive: true });
    const outputs: Record<string, unknown> = {
      "cloudinary-audit-summary.json": auditReport,
      "cloudinary-to-r2-migration-map.json": migrationMap,
      "cloudinary-orphan-candidates.json": {
        generatedAt: summary.generatedAt,
        warning: "Orphan candidates are not safe-to-delete determinations and may have external consumers.",
        cloudinaryAdminApiAvailable: cloudinaryResult.available,
        assets: orphanResources,
      },
      "cloudinary-broken-references.json": brokenReport,
      "cloudinary-conflicting-itemnos.json": conflictingItemNos,
    };
    await Promise.all(Object.entries(outputs).map(([name, contents]) =>
      writeFile(`${REPORT_DIRECTORY}/${name}`, `${JSON.stringify(contents, null, 2)}\n`, "utf8")
    ));

    const textSummary = [
      "Cloudinary migration audit (READ-ONLY)",
      `Generated: ${summary.generatedAt}`,
      "",
      `Cloudinary assets in account:                 ${summary.cloudinaryAssetsInAccount ?? "unavailable"}`,
      `Cloudinary URL references in MongoDB:         ${summary.totalCloudinaryUrlReferencesInMongoDb}`,
      `Unique exact Cloudinary URLs:                 ${summary.uniqueExactCloudinaryUrls}`,
      `Unique normalized Cloudinary public IDs:      ${summary.uniqueNormalizedCloudinaryPublicIds}`,
      `Referenced Cloudinary assets found:           ${summary.referencedCloudinaryAssetsFound ?? "unavailable"}`,
      `Orphan candidates:                            ${summary.orphanCandidateAssets ?? "unavailable"}`,
      `Broken DB public IDs:                         ${summary.brokenCloudinaryPublicIds ?? "unavailable"}`,
      `Malformed Cloudinary references:              ${summary.malformedCloudinaryReferences}`,
      `Non-durable blob URL references:              ${summary.nonDurableBlobReferences}`,
      `Broken/malformed DB URL references:           ${summary.brokenOrMalformedDatabaseUrlReferences}`,
      `Shared assets:                                ${summary.sharedAssets}`,
      `Conflicting Item Nos:                         ${summary.conflictingItemNos}`,
      `Existing R2 URLs in MongoDB:                  ${summary.existingR2UrlReferences}`,
      `Proposed migration assets:                    ${summary.proposedMigrationAssets}`,
      `Referenced storage:                           ${summary.storage.referencedAssets.megabytes} MB (${summary.storage.referencedAssets.gigabytes} GB)`,
      "",
      "No MongoDB, R2, or Cloudinary data was modified. No image binaries were downloaded.",
    ].join("\n");
    await writeFile(`${REPORT_DIRECTORY}/cloudinary-audit-summary.txt`, `${textSummary}\n`, "utf8");
    console.log(textSummary);
  } finally {
    await client.close();
  }
};

if (process.argv.includes("--self-test")) {
  runParserSelfTests();
  console.log("Cloudinary URL parser self-tests passed.");
} else {
  await main();
}
