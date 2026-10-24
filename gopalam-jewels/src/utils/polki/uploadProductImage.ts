type UploadImageResponse = {
  success?: boolean;
  imageUrl?: string;
  cloudinaryUrl?: string | null;
  r2Url?: string | null;
  r2ShadowStatus?: "disabled" | "success" | "failed";
  resolvedImageUrl?: string;
  fallbackImageUrl?: string;
  error?: string;
};

export type UploadedProductImage = {
  imageUrl: string;
  cloudinaryUrl: string;
  r2Image?: string;
  r2ShadowStatus: "disabled" | "success" | "failed";
  resolvedImageUrl: string;
  fallbackImageUrl: string;
};

const compressImage = (file: File): Promise<File> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const sourceUrl = URL.createObjectURL(file);

    const timeout = setTimeout(() => { URL.revokeObjectURL(sourceUrl); reject(new Error("Image decoding timed out")); }, 12000);
    image.onload = () => {
      clearTimeout(timeout);
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context?.drawImage(image, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(sourceUrl);

          if (!blob) {reject(new Error("Unable to resize image"));return;}
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {type:"image/jpeg",lastModified:Date.now()}));
        },
        "image/jpeg",
        0.6
      );
    };

    image.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(sourceUrl);
      reject(new Error("Unable to decode image"));
    };

    image.src = sourceUrl;
  });

const uploadOne = async (file: File) => {
  const compressedFile = await compressImage(file);
  const formData = new FormData();
  formData.append("file", compressedFile);

  const response = await fetch("/api/upload-image", {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    body: formData,
  });
  const data = (await response.json()) as UploadImageResponse;

  if (!response.ok || !data.success || !data.imageUrl) {
    throw new Error(data.error || "Image upload failed");
  }

  const r2ShadowStatus = data.r2ShadowStatus || "disabled";
  return {
    imageUrl: data.imageUrl,
    cloudinaryUrl: data.cloudinaryUrl || data.imageUrl,
    ...(r2ShadowStatus !== "disabled" ? { r2Image: data.r2Url || "" } : {}),
    r2ShadowStatus,
    resolvedImageUrl: data.resolvedImageUrl || data.imageUrl,
    fallbackImageUrl: data.fallbackImageUrl || "",
  } satisfies UploadedProductImage;
};

let activeUploads = 0;
const uploadQueue: Array<() => void> = [];
export const uploadProductImage = async (file: File) => {
  if (activeUploads >= 3) await new Promise<void>(resolve => uploadQueue.push(resolve));
  else activeUploads++;
  try { return await uploadOne(file); }
  finally { const next = uploadQueue.shift(); if (next) next(); else activeUploads--; }
};
