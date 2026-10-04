export type ImageProvider = "cloudinary" | "r2";

export type ImageCandidates = {
  primaryUrl: string;
  fallbackUrl: string;
  primaryProvider: ImageProvider | null;
  fallbackProvider: ImageProvider | null;
};

export const parseImageFetchProvider = (value: unknown): ImageProvider =>
  String(value ?? "").trim().toLowerCase() === "r2" ? "r2" : "cloudinary";

export const normalizePersistentImageUrl = (value: unknown) => {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.toLowerCase().startsWith("blob:")) return "";

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? candidate : "";
  } catch {
    return "";
  }
};

export const resolveImageCandidates = ({
  image,
  r2Image,
  provider,
}: {
  image?: unknown;
  r2Image?: unknown;
  provider?: unknown;
}): ImageCandidates => {
  const configuredProvider = parseImageFetchProvider(provider);
  const cloudinaryUrl = normalizePersistentImageUrl(image);
  const r2Url = normalizePersistentImageUrl(r2Image);
  const ordered = configuredProvider === "r2"
    ? ([{ provider: "r2", url: r2Url }, { provider: "cloudinary", url: cloudinaryUrl }] as const)
    : ([{ provider: "cloudinary", url: cloudinaryUrl }, { provider: "r2", url: r2Url }] as const);
  const available = ordered.filter((candidate) => candidate.url);
  const primary = available[0];
  const fallback = available.find((candidate) => candidate.url !== primary?.url);

  return {
    primaryUrl: primary?.url || "",
    fallbackUrl: fallback?.url || "",
    primaryProvider: primary?.provider || null,
    fallbackProvider: fallback?.provider || null,
  };
};

