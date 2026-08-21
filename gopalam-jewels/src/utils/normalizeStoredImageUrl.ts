export const normalizeStoredImageUrl = (value: unknown) => {
  const imageUrl = String(value ?? "").trim();
  return imageUrl.toLowerCase().startsWith("blob:") ? "" : imageUrl;
};
