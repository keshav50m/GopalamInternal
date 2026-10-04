import { resolveImageCandidates } from "@/utils/imageProvider";

export const getImageFetchProvider = () =>
  String(process.env.IMAGE_FETCH_PROVIDER ?? "").trim().toLowerCase() === "r2"
    ? "r2"
    : "cloudinary";

export const resolveConfiguredImageCandidates = (
  image: unknown,
  r2Image: unknown
) => resolveImageCandidates({ image, r2Image, provider: getImageFetchProvider() });

export const withResolvedImageFields = <T extends Record<string, any>>(value: T) => {
  const candidates = resolveConfiguredImageCandidates(value.image, value.r2Image);
  return {
    ...value,
    resolvedImageUrl: candidates.primaryUrl,
    fallbackImageUrl: candidates.fallbackUrl,
    resolvedImageProvider: candidates.primaryProvider,
  };
};

