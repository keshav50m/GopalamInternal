import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedUser } from "@/lib/auth";
import { uploadImageToR2 } from "@/lib/r2";

const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const FILE_EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const getImageStorageProvider = () => {
  const provider = process.env.IMAGE_STORAGE_PROVIDER?.trim().toLowerCase();
  return provider === "r2" ? "r2" : "cloudinary";
};

const shouldWriteImagesToBoth = () =>
  process.env.WRITE_IMAGES_TO_BOTH?.trim().toLowerCase() === "true";

const sanitizeFileName = (fileName: string) => {
  const nameWithoutExtension = fileName.replace(/\.[^.]+$/, "");
  const safeName = nameWithoutExtension
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return safeName || "image";
};

const createObjectKey = (file: File) => {
  const safeName = sanitizeFileName(file.name);
  const extension = FILE_EXTENSION_BY_CONTENT_TYPE[file.type];
  return `products/${Date.now()}-${randomUUID()}-${safeName}.${extension}`;
};

const uploadImageToCloudinary = async (file: File) => {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim();
  const uploadPreset =
    process.env.CLOUDINARY_UPLOAD_PRESET?.trim() || "gopalam_jewels";

  if (!cloudName) {
    throw new Error("Cloudinary cloud name is not configured");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
    { method: "POST", body: formData }
  );
  const data = await response.json();

  if (!response.ok || !data.secure_url) {
    throw new Error(data.error?.message || "Cloudinary upload failed");
  }

  return {
    imageUrl: String(data.secure_url),
    objectKey: String(data.public_id || ""),
  };
};

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "An image file is required" },
        { status: 400 }
      );
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, and WebP images are supported" },
        { status: 415 }
      );
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "Image must be 20 MB or smaller" },
        { status: 413 }
      );
    }

    const provider = getImageStorageProvider();
    const dualWriteEnabled =
      provider === "cloudinary" && shouldWriteImagesToBoth();
    let result: { imageUrl: string; objectKey: string };
    let cloudinaryUrl: string | null = null;
    let r2Url: string | null = null;
    let r2ShadowStatus: "disabled" | "success" | "failed" = "disabled";

    if (provider === "r2") {
      const objectKey = createObjectKey(file);
      const body = new Uint8Array(await file.arrayBuffer());

      console.info("[R2 Upload]", {
        objectKey,
        size: file.size,
        contentType: file.type,
      });

      result = await uploadImageToR2({
        body,
        contentType: file.type,
        objectKey,
      });
    } else {
      result = await uploadImageToCloudinary(file);
      cloudinaryUrl = result.imageUrl;

      if (dualWriteEnabled) {
        const objectKey = createObjectKey(file);

        try {
          const body = new Uint8Array(await file.arrayBuffer());
          const r2Result = await uploadImageToR2({
            body,
            contentType: file.type,
            objectKey,
          });
          r2Url = r2Result.imageUrl;
          r2ShadowStatus = "success";
        } catch (shadowError) {
          r2ShadowStatus = "failed";
          console.error("[R2 Shadow Upload Failed]", {
            timestamp: new Date().toISOString(),
            cloudinaryUploadSucceeded: true,
            objectKey,
            size: file.size,
            contentType: file.type,
            reason:
              shadowError instanceof Error
                ? shadowError.message
                : "Unknown R2 shadow upload error",
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      provider,
      ...result,
      cloudinaryUrl,
      r2Url,
      r2ShadowStatus,
    });
  } catch (error) {
    console.error("Image upload failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json(
      { error: "Image upload failed" },
      { status: 500 }
    );
  }
}
