import { mkdir, writeFile } from "node:fs/promises";
import { MongoClient } from "mongodb";

type CloudinaryReference = {
  collection: "savedProducts" | "imageCatalogue";
  documentId: string;
  barcode: string;
  itemNo: string;
  field: string;
  url: string;
  parsed: ParsedCloudinaryUrl | null;
};

type ParsedCloudinaryUrl = {
  cloudName: string;
  resourceType: string;
  deliveryType: string;
  transformation: string;
  version: string;
  publicId: string;
  extension: string;
  normalizedAssetKey: string;
};

const normalize = (value: unknown) => String(value ?? "").trim();

const isTransformationSegment = (segment: string) => {
  if (/^s--[^/]+--$/.test(segment)) return true;

  return segment.split(",").every((component) =>
    /^(?:a|ac|af|ar|b|bo|c|co|cs|d|dl|dn|dpr|du|e|eo|f|fl|fn|fps|g|h|if|ki|l|o|p|pg|q|r|so|sp|t|u|vc|vs|w|x|y|z)_.+/.test(
      component
    )
  );
};

export const parseCloudinaryUrl = (
  input: unknown
): ParsedCloudinaryUrl | null => {
  const rawUrl = normalize(input);
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.hostname.toLowerCase() !== "res.cloudinary.com") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 4) return null;

  const [cloudName, resourceType, deliveryType, ...deliverySegments] = segments;
  const versionIndex = deliverySegments.findIndex((segment) =>
    /^v\d+$/.test(segment)
  );

  let transformationSegments: string[] = [];
  let assetSegments: string[] = [];
  let version = "";

  if (versionIndex >= 0) {
    transformationSegments = deliverySegments.slice(0, versionIndex);
    version = deliverySegments[versionIndex];
    assetSegments = deliverySegments.slice(versionIndex + 1);
  } else {
    let assetStart = 0;
    while (
      assetStart < deliverySegments.length - 1 &&
      isTransformationSegment(deliverySegments[assetStart])
    ) {
      assetStart += 1;
    }
    transformationSegments = deliverySegments.slice(0, assetStart);
    assetSegments = deliverySegments.slice(assetStart);
  }

  if (assetSegments.length === 0) return null;

  const finalSegment = assetSegments[assetSegments.length - 1];
  const extensionMatch = finalSegment.match(/\.([a-zA-Z0-9]+)$/);
  const extension = extensionMatch?.[1]?.toLowerCase() || "";
  const publicIdSegments = [...assetSegments];
  publicIdSegments[publicIdSegments.length - 1] = extension
    ? finalSegment.slice(0, -(extension.length + 1))
    : finalSegment;
  const publicId = decodeURIComponent(publicIdSegments.join("/"));

  if (!publicId) return null;

  return {
    cloudName,
    resourceType,
    deliveryType,
    transformation: transformationSegments.join("/"),
    version,
    publicId,
    extension,
    normalizedAssetKey: `${cloudName}/${resourceType}/${deliveryType}/${publicId}`,
  };
};

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

const referenceSummary = (reference: CloudinaryReference) => ({
  collection: reference.collection,
  documentId: reference.documentId,
  barcode: reference.barcode,
  itemNo: reference.itemNo,
  field: reference.field,
  url: reference.url,
});

const main = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error(
      "MONGO_URI is required in the process environment. Its value is never logged."
    );
  }

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db(process.env.MONGO_DB_NAME || "gopalamJewels");
    const [savedProducts, imageCatalogue] = await Promise.all([
      db
        .collection("savedProducts")
        .find({})
        .project({ barcode: 1, image: 1, imageUrl: 1, "data.ITEMNO": 1 })
        .toArray(),
      db
        .collection("imageCatalogue")
        .find({})
        .project({ itemNo: 1, image: 1, imageUrl: 1 })
        .toArray(),
    ]);

    const references: CloudinaryReference[] = [];

    savedProducts.forEach((document) => {
      [
        ["image", document.image],
        ["imageUrl", document.imageUrl],
      ].forEach(([field, value]) => {
        const url = normalize(value);
        if (!url) return;
        references.push({
          collection: "savedProducts",
          documentId: normalize(document._id),
          barcode: normalize(document.barcode),
          itemNo: normalize(document.data?.ITEMNO),
          field: String(field),
          url,
          parsed: parseCloudinaryUrl(url),
        });
      });
    });

    imageCatalogue.forEach((document) => {
      [
        ["image", document.image],
        ["imageUrl", document.imageUrl],
      ].forEach(([field, value]) => {
        const url = normalize(value);
        if (!url) return;
        references.push({
          collection: "imageCatalogue",
          documentId: normalize(document._id),
          barcode: "",
          itemNo: normalize(document.itemNo),
          field: String(field),
          url,
          parsed: parseCloudinaryUrl(url),
        });
      });
    });

    const cloudinaryReferences = references.filter(
      (reference) => reference.parsed
    );
    const byUrl = groupBy(cloudinaryReferences, (reference) => reference.url);
    const byAsset = groupBy(
      cloudinaryReferences,
      (reference) => reference.parsed!.normalizedAssetKey
    );
    const byItemNo = groupBy(
      cloudinaryReferences.filter((reference) => reference.itemNo),
      (reference) => reference.itemNo.toUpperCase()
    );

    const duplicateUrls = [...byUrl.entries()]
      .filter(([, group]) => group.length > 1)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([url, group]) => ({
        url,
        referenceCount: group.length,
        references: group.map(referenceSummary),
      }));

    const mostReferencedAssets = [...byAsset.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 50)
      .map(([assetKey, group]) => ({
        assetKey,
        publicId: group[0].parsed!.publicId,
        referenceCount: group.length,
        uniqueUrlCount: new Set(group.map((reference) => reference.url)).size,
        barcodes: [...new Set(group.map((reference) => reference.barcode).filter(Boolean))],
        itemNos: [...new Set(group.map((reference) => reference.itemNo).filter(Boolean))],
        references: group.map(referenceSummary),
      }));

    const itemNosWithMultipleAssets = [...byItemNo.entries()]
      .map(([normalizedItemNo, group]) => {
        const assets = new Set(
          group.map((reference) => reference.parsed!.normalizedAssetKey)
        );
        return {
          normalizedItemNo,
          displayItemNos: [...new Set(group.map((reference) => reference.itemNo))],
          assetCount: assets.size,
          assetKeys: [...assets],
          references: group.map(referenceSummary),
        };
      })
      .filter((entry) => entry.assetCount > 1)
      .sort((a, b) => b.assetCount - a.assetCount);

    const assetsUsedByMultipleBarcodes = [...byAsset.entries()]
      .map(([assetKey, group]) => ({
        assetKey,
        publicId: group[0].parsed!.publicId,
        barcodes: [...new Set(group.map((reference) => reference.barcode).filter(Boolean))],
        itemNos: [...new Set(group.map((reference) => reference.itemNo).filter(Boolean))],
      }))
      .filter((entry) => entry.barcodes.length > 1)
      .sort((a, b) => b.barcodes.length - a.barcodes.length);

    const savedAssetKeys = new Set(
      cloudinaryReferences
        .filter((reference) => reference.collection === "savedProducts")
        .map((reference) => reference.parsed!.normalizedAssetKey)
    );
    const catalogueAssetKeys = new Set(
      cloudinaryReferences
        .filter((reference) => reference.collection === "imageCatalogue")
        .map((reference) => reference.parsed!.normalizedAssetKey)
    );

    const transformationOrVersionVariants = [...byAsset.entries()]
      .map(([assetKey, group]) => ({
        assetKey,
        publicId: group[0].parsed!.publicId,
        urls: [...new Set(group.map((reference) => reference.url))],
        transformations: [
          ...new Set(group.map((reference) => reference.parsed!.transformation)),
        ],
        versions: [...new Set(group.map((reference) => reference.parsed!.version))],
      }))
      .filter((entry) => entry.urls.length > 1);

    const report = {
      generatedAt: new Date().toISOString(),
      database: process.env.MONGO_DB_NAME || "gopalamJewels",
      summary: {
        totalSavedProductsDocuments: savedProducts.length,
        savedProductsDocumentsWithImageUrls: new Set(
          references
            .filter((reference) => reference.collection === "savedProducts")
            .map((reference) => reference.documentId)
        ).size,
        totalImageCatalogueDocuments: imageCatalogue.length,
        imageCatalogueDocumentsWithImageUrls: new Set(
          references
            .filter((reference) => reference.collection === "imageCatalogue")
            .map((reference) => reference.documentId)
        ).size,
        totalUrlReferences: references.length,
        cloudinaryUrlReferences: cloudinaryReferences.length,
        nonCloudinaryUrlReferences: references.length - cloudinaryReferences.length,
        uniqueFullCloudinaryUrls: byUrl.size,
        uniqueCloudinaryAssetKeys: byAsset.size,
        duplicateDatabaseReferences:
          cloudinaryReferences.length - byAsset.size,
        urlsReferencedMoreThanOnce: duplicateUrls.length,
        itemNosWithMultipleCloudinaryAssets: itemNosWithMultipleAssets.length,
        assetsReferencedByMultipleBarcodes: assetsUsedByMultipleBarcodes.length,
      },
      top50MostReferencedAssets: mostReferencedAssets,
      duplicateUrls,
      itemNosWithMultipleAssets,
      assetsUsedByMultipleBarcodes,
      savedProductsAssetsMissingFromImageCatalogue: [...savedAssetKeys].filter(
        (assetKey) => !catalogueAssetKeys.has(assetKey)
      ),
      imageCatalogueAssetsMissingFromSavedProducts: [...catalogueAssetKeys].filter(
        (assetKey) => !savedAssetKeys.has(assetKey)
      ),
      transformationOrVersionVariants,
      referencedAssets: [...byAsset.entries()].map(([assetKey, group]) => ({
        assetKey,
        cloudName: group[0].parsed!.cloudName,
        resourceType: group[0].parsed!.resourceType,
        deliveryType: group[0].parsed!.deliveryType,
        publicId: group[0].parsed!.publicId,
        referenceCount: group.length,
      })),
      nonCloudinaryReferences: references
        .filter((reference) => !reference.parsed)
        .map(referenceSummary),
    };

    await mkdir("audit-reports", { recursive: true });
    const reportPath = "audit-reports/cloudinary-reference-audit.json";
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

    console.log(JSON.stringify(report.summary, null, 2));
    console.log(`Read-only report written to ${reportPath}`);
  } finally {
    await client.close();
  }
};

await main();
