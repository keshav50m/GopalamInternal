const CLOUDINARY_HOST = "res.cloudinary.com";

export const buildCloudinaryDeliveryUrl = (
  source: unknown,
  transformation: string
) => {
  const sourceUrl = String(source ?? "").trim();
  if (!sourceUrl || !transformation) return sourceUrl;

  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return sourceUrl;
  }

  if (url.hostname.toLowerCase() !== CLOUDINARY_HOST) return sourceUrl;

  const segments = url.pathname.split("/").filter(Boolean);
  const uploadIndex = segments.indexOf("upload");
  if (uploadIndex < 0) return sourceUrl;

  const versionIndex = segments.findIndex(
    (segment, index) => index > uploadIndex && /^v\d+$/.test(segment)
  );

  if (versionIndex > uploadIndex) {
    segments.splice(
      uploadIndex + 1,
      versionIndex - uploadIndex - 1,
      transformation
    );
  } else {
    segments.splice(uploadIndex + 1, 0, transformation);
  }

  url.pathname = `/${segments.join("/")}`;
  return url.toString();
};

export const getCloudinaryAssetKey = (source: unknown) => {
  const sourceUrl = String(source ?? "").trim();
  if (!sourceUrl) return "";

  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return sourceUrl;
  }

  if (url.hostname.toLowerCase() !== CLOUDINARY_HOST) return sourceUrl;

  const segments = url.pathname.split("/").filter(Boolean);
  const uploadIndex = segments.indexOf("upload");
  if (uploadIndex < 0) return sourceUrl;

  const versionIndex = segments.findIndex(
    (segment, index) => index > uploadIndex && /^v\d+$/.test(segment)
  );
  const assetSegments =
    versionIndex > uploadIndex
      ? segments.slice(versionIndex + 1)
      : segments.slice(uploadIndex + 1);

  if (!assetSegments.length) return sourceUrl;

  const finalSegment = assetSegments.at(-1)!;
  assetSegments[assetSegments.length - 1] = finalSegment.replace(
    /\.[a-zA-Z0-9]+$/,
    ""
  );

  return `${segments[0]}/${segments[1]}/${segments[2]}/${decodeURIComponent(
    assetSegments.join("/")
  )}`;
};

export const getFileUploadKey = async (
  file: File,
  scope = ""
) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer()
  );
  const contentHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `${scope.trim().toUpperCase()}|${contentHash}`;
};

export const CLOUDINARY_THUMBNAIL_TRANSFORMATION =
  "f_auto,q_auto:good,w_240,h_240,c_limit";

export const CLOUDINARY_PDF_TRANSFORMATION =
  "f_jpg,q_auto:good,w_1200,h_1200,c_limit";
