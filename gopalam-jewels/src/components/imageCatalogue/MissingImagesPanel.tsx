"use client";

import { useState } from "react";
import styles from "./ImageCatalogue.module.css";
import { uploadImageToCloudinary } from "./imageUpload";

type MissingProduct = {
  _id: string;
  barcode: string | number;
  itemNo: string;
  file: File | null;
  previewUrl: string;
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
        };
      })
    );
    setMessage("");
    setError("");
  };

  const persistProductImage = async (product: MissingProduct) => {
    if (!product.file) {
      throw new Error(`Select an image for Item No ${product.itemNo || "unknown"}`);
    }

    if (!product.itemNo) {
      throw new Error(`Item No is missing for barcode ${product.barcode}`);
    }

    const image = await uploadImageToCloudinary(product.file);
    const response = await fetch("/api/missing-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        barcode: product.barcode,
        itemNo: product.itemNo,
        image,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to save product image");
    }
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
    const selectedProducts = products.filter((product) => product.file);

    setMessage("");
    setError("");

    if (selectedProducts.length === 0) {
      setError("Select at least one image to save.");
      return;
    }

    setSavingIds(new Set(selectedProducts.map((product) => product._id)));

    const successfulIds: string[] = [];
    const failures: string[] = [];

    for (const product of selectedProducts) {
      try {
        await persistProductImage(product);
        successfulIds.push(product._id);
      } catch (saveError) {
        failures.push(
          `${product.itemNo || product.barcode}: ${
            saveError instanceof Error ? saveError.message : "Upload failed"
          }`
        );
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
                            src={product.previewUrl}
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
                          isSaving || !product.file || !product.itemNo
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
