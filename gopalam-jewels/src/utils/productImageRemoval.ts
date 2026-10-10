export const getRemovedImageCandidates = (imageRemoved: unknown) =>
  imageRemoved === true
    ? { primaryUrl: "", fallbackUrl: "", image: "", r2Image: "" }
    : null;
