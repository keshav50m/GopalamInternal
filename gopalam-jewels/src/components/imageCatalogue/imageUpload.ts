export const compressImage = (file: File): Promise<File> => {
  return new Promise((resolve) => {
    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const sourceUrl = URL.createObjectURL(file);

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(sourceUrl);

          if (!blob) {
            resolve(file);
            return;
          }

          resolve(
            new File([blob], file.name, {
              type: "image/jpeg",
              lastModified: Date.now(),
            })
          );
        },
        "image/jpeg",
        0.6
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      resolve(file);
    };

    img.src = sourceUrl;
  });
};

export const uploadImageToCloudinary = async (file: File) => {
  const compressedFile = await compressImage(file);
  const formData = new FormData();

  formData.append("file", compressedFile);
  formData.append("upload_preset", "gopalam_jewels");

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: formData }
  );
  const data = await response.json();

  if (!response.ok || !data.secure_url) {
    throw new Error(data.error?.message || "Cloudinary upload failed");
  }

  return String(data.secure_url);
};
