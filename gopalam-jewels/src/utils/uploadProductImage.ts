type UploadImageResponse = {
  success?: boolean;
  imageUrl?: string;
  error?: string;
};

const compressImage = (file: File): Promise<File> =>
  new Promise((resolve) => {
    const image = new Image();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const sourceUrl = URL.createObjectURL(file);

    image.onload = () => {
      canvas.width = image.width;
      canvas.height = image.height;
      context?.drawImage(image, 0, 0);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(sourceUrl);

          resolve(
            blob
              ? new File([blob], file.name, {
                  type: "image/jpeg",
                  lastModified: Date.now(),
                })
              : file
          );
        },
        "image/jpeg",
        0.6
      );
    };

    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      resolve(file);
    };

    image.src = sourceUrl;
  });

export const uploadProductImage = async (file: File) => {
  const compressedFile = await compressImage(file);
  const formData = new FormData();
  formData.append("file", compressedFile);

  const response = await fetch("/api/upload-image", {
    method: "POST",
    body: formData,
  });
  const data = (await response.json()) as UploadImageResponse;

  if (!response.ok || !data.success || !data.imageUrl) {
    throw new Error(data.error || "Image upload failed");
  }

  return data.imageUrl;
};
