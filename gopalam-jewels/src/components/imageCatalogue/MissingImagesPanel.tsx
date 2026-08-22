"use client";

import { useState } from "react";
import styles from "./ImageCatalogue.module.css";
import {
  uploadProductImage,
  type UploadedProductImage,
} from "@/utils/uploadProductImage";
import {
  buildCloudinaryDeliveryUrl,
  CLOUDINARY_THUMBNAIL_TRANSFORMATION,
  getFileUploadKey,
} from "@/utils/cloudinaryDelivery";

type MissingProduct = {
  _id: string;
  barcode: string | number;
  itemNo: string;
  file: File | null;
  previewUrl: string;
  uploadedUrl?: string;
  uploadedR2Url?: string;
};

type MissingProductImage = {
  barcode: string | number;
  itemNo: string;
  image: string;
  r2Image?: string;
};

export default function MissingImagesPanel() {
  const [limit, setLimit] = useState(50);
  const [products, setProducts] = useState<MissingProduct[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadProducts = async () => {
    setMessage("");
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch(`/api/missing-products?limit=${limit}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to load products");
      }

      setProducts(
        data.map((product: any) => ({
          ...product,
          itemNo: String(product.itemNo || product.data?.ITEMNO || "").trim(),
          file: null,
          previewUrl: "",
        }))
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load products"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (id: string, file: File | null) => {
    setProducts((currentProducts) =>
      currentProducts.map((product) => {
        if (product._id !== id) return product;

        if (product.previewUrl) {
          URL.revokeObjectURL(product.previewUrl);
        }

        return {
          ...product,
          file,
          previewUrl: file ? URL.createObjectURL(file) : "",
          uploadedUrl: "",
          uploadedR2Url: undefined,
        };
      })
    );
    setMessage("");
    setError("");
  };

  const prepareProductImage = async (
    product: MissingProduct,
    uploadCache = new Map<string, Promise<UploadedProductImage>>()
  ): Promise<MissingProductImage> => {
    if (!product.file && !product.uploadedUrl) {
      throw new Error(`Select an image for Item No ${product.itemNo || "unknown"}`);
    }

    if (!product.itemNo) {
      throw new Error(`Item No is missing for barcode ${product.barcode}`);
    }

    let image = product.uploadedUrl || "";
    let r2Image = product.uploadedR2Url;

    if (!image && product.file) {
      const uploadKey = await getFileUploadKey(
        product.file,
        product.itemNo
      );

      if (!uploadCache.has(uploadKey)) {
        uploadCache.set(
          uploadKey,
          uploadProductImage(product.file)
        );
      }

      const uploadedImage = await uploadCache.get(uploadKey)!;
      image = uploadedImage.imageUrl;
      if (Object.prototype.hasOwnProperty.call(uploadedImage, "r2Image")) {
        r2Image = uploadedImage.r2Image || "";
      }

      if (product.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(product.previewUrl);
      }

      setProducts((currentProducts) =>
        currentProducts.map((currentProduct) =>
          currentProduct._id === product._id
            ? {
                ...currentProduct,
                file: null,
                previewUrl: image,
                uploadedUrl: image,
                ...(r2Image !== undefined ? { uploadedR2Url: r2Image } : {}),
              }
            : currentProduct
        )
      );
    }

    return {
      barcode: product.barcode,
      itemNo: product.itemNo,
      image,
      ...(r2Image !== undefined ? { r2Image } : {}),
    };
  };

  const saveProductImages = async (
    items: MissingProductImage[],
    batch = false
  ) => {
    const body = batch
      ? { items }
      : items[0];
    const response = await fetch("/api/missing-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to save product image");
    }

    return data;
  };

  const persistProductImage = async (
    product: MissingProduct,
    uploadCache = new Map<string, Promise<UploadedProductImage>>()
  ) => {
    const item = await prepareProductImage(product, uploadCache);
    await saveProductImages([item]);
  };

  const handleSave = async (product: MissingProduct) => {
    setMessage("");
    setError("");
    setSavingIds((current) => new Set(current).add(product._id));

    try {
      await persistProductImage(product);
      setProducts((current) =>
        current.filter((item) => item._id !== product._id)
      );
      setMessage(`Image saved successfully for Item No ${product.itemNo}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Upload failed");
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(product._id);
        return next;
      });
    }
  };

  const handleSaveAll = async () => {
    const selectedProducts = products.filter(
      (product) => product.file || product.uploadedUrl
    );

    setMessage("");
    setError("");

    if (selectedProducts.length === 0) {
      setError("Select at least one image to save.");
      return;
    }

    setSavingIds(new Set(selectedProducts.map((product) => product._id)));

    const successfulIds: string[] = [];
    const failures: string[] = [];
    const uploadCache = new Map<string, Promise<UploadedProductImage>>();
    const preparedItems: {
      product: MissingProduct;
      item: MissingProductImage;
    }[] = [];

    for (const product of selectedProducts) {
      try {
        preparedItems.push({
          product,
          item: await prepareProductImage(product, uploadCache),
        });
      } catch (saveError) {
        failures.push(
          `${product.itemNo || product.barcode}: ${
            saveError instanceof Error ? saveError.message : "Upload failed"
          }`
        );
      }
    }

    if (preparedItems.length > 0) {
      try {
        const result = await saveProductImages(
          preparedItems.map(({ item }) => item),
          true
        );
        const savedBarcodes = new Set(
          (Array.isArray(result.savedBarcodes) ? result.savedBarcodes : [])
            .map((barcode: unknown) => String(barcode || "").trim())
        );

        preparedItems.forEach(({ product }) => {
          if (savedBarcodes.has(String(product.barcode || "").trim())) {
            successfulIds.push(product._id);
          } else {
            failures.push(`${product.itemNo || product.barcode}: saved product was not found`);
          }
        });
      } catch (saveError) {
        preparedItems.forEach(({ product }) => {
          failures.push(
            `${product.itemNo || product.barcode}: ${
              saveError instanceof Error ? saveError.message : "Save failed"
            }`
          );
        });
      }
    }

    setProducts((current) =>
      current.filter((product) => !successfulIds.includes(product._id))
    );
    setSavingIds(new Set());

    const skippedCount = products.length - selectedProducts.length;
    setMessage(
      `${successfulIds.length} image${successfulIds.length === 1 ? "" : "s"} saved` +
        (skippedCount ? `, ${skippedCount} row${skippedCount === 1 ? "" : "s"} skipped` : "") +
        "."
    );

    if (failures.length) {
      setError(`${failures.length} upload${failures.length === 1 ? "" : "s"} failed: ${failures.join("; ")}`);
    }
  };

  const isSaving = savingIds.size > 0;

  return (
    <section className={`${styles.card} ${styles.missingImagesCard}`}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>Products Missing Images</h2>
          <p>Upload images for saved products that do not have catalogue images.</p>
        </div>

        <div className={styles.loadActions}>
          <select
            className={styles.limitSelect}
            value={limit}
            disabled={isLoading || isSaving}
            aria-label="Products to load"
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={150}>150</option>
          </select>

          <button
            className={styles.secondaryButton}
            disabled={isLoading || isSaving}
            onClick={loadProducts}
          >
            {isLoading ? "Loading..." : "Load Products"}
          </button>
          <button
            className={styles.button}
            disabled={isLoading || isSaving || products.length === 0}
            onClick={handleSaveAll}
          >
            {isSaving ? "Saving..." : "Save All"}
          </button>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.missingProductsTable}>
          <thead>
            <tr>
              <th>Image</th>
              <th>Item No</th>
              <th>Barcode</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td className={styles.emptyTable} colSpan={4}>
                  Load products to view missing images.
                </td>
              </tr>
            ) : (
              products.map((product) => {
                const rowIsSaving = savingIds.has(product._id);

                return (
                  <tr key={product._id}>
                    <td>
                      <div className={styles.imageCell}>
                        <label className={styles.filePicker}>
                          Choose
                          <input
                            type="file"
                            accept="image/*"
                            disabled={isSaving}
                            onChange={(event) =>
                              handleFileChange(
                                product._id,
                                event.target.files?.[0] || null
                              )
                            }
                          />
                        </label>
                        {product.previewUrl ? (
                          <img
                            className={styles.thumbnail}
                            src={buildCloudinaryDeliveryUrl(
                              product.previewUrl,
                              CLOUDINARY_THUMBNAIL_TRANSFORMATION
                            )}
                            loading="lazy"
                            decoding="async"
                            alt={`Preview for ${product.itemNo}`}
                          />
                        ) : (
                          <span className={styles.noPreview}>No image selected</span>
                        )}
                      </div>
                    </td>
                    <td>{product.itemNo || "Not available"}</td>
                    <td>{product.barcode}</td>
                    <td>
                      <button
                        className={styles.button}
                        disabled={
                          isSaving ||
                          (!product.file && !product.uploadedUrl) ||
                          !product.itemNo
                        }
                        onClick={() => handleSave(product)}
                      >
                        {rowIsSaving ? "Saving..." : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {message ? <div className={styles.success}>{message}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
    </section>
  );
}
