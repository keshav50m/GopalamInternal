"use client";

/* eslint-disable @next/next/no-img-element -- authenticated provider URLs and local blob previews are dynamic */

import { useState } from "react";
import { uploadProductImage } from "@/utils/uploadProductImage";
import { QR_PRODUCT_FIELDS, type QRProductData } from "@/utils/qrProductData";
import styles from "./QRUpdateReview.module.css";

export type QRUpdateConflict = {
  id: string;
  barcode: string;
  currentProduct: { data?: Record<string, unknown>; image?: string; r2Image?: string };
  newData: QRProductData;
  currentImage: string;
  changedFields: string[];
  imageChoice: "existing" | "new";
  newImageFile?: File | null;
  newImagePreview?: string;
  status?: "idle" | "updating";
  error?: string;
};

type Props = {
  conflicts: QRUpdateConflict[];
  open: boolean;
  onClose: () => void;
  onChange: (id: string, patch: Partial<QRUpdateConflict>) => void;
  onResolved: (resolved: Array<{ id: string; barcode: string; newData: QRProductData; image: string; r2Image?: string }>) => void;
};

const LABELS: Record<string, string> = {
  ITEMNO: "Item No", "STONE NAME": "Stone", "GROSS WT": "Gross",
  "STONE WT": "Stone Wt", "DAI WT": "DAI", "TAG PRICE": "Price",
  SIZE: "Size", USD: "USD",
};

export default function QRUpdateReview({ conflicts, open, onClose, onChange, onResolved }: Props) {
  const [updatingAll, setUpdatingAll] = useState(false);
  const [summary, setSummary] = useState("");

  if (!open) return null;

  const updateConflicts = async (targets: QRUpdateConflict[]) => {
    const ready: Array<{
      conflict: QRUpdateConflict;
      image: string;
      r2Image?: string;
      replaceImage: boolean;
    }> = [];

    for (const conflict of targets) {
      onChange(conflict.id, { status: "updating", error: "" });
      try {
        if (conflict.imageChoice === "new") {
          if (!conflict.newImageFile) {
            throw new Error("Select a new image before updating.");
          }
          const uploadedImage = await uploadProductImage(conflict.newImageFile);
          ready.push({
            conflict,
            image: uploadedImage.imageUrl,
            ...(Object.prototype.hasOwnProperty.call(uploadedImage, "r2Image")
              ? { r2Image: uploadedImage.r2Image || "" }
              : {}),
            replaceImage: true,
          });
        } else {
          ready.push({
            conflict,
            image: conflict.currentImage || "",
            ...(Object.prototype.hasOwnProperty.call(conflict.currentProduct, "r2Image")
              ? { r2Image: String(conflict.currentProduct.r2Image || "") }
              : {}),
            replaceImage: false,
          });
        }
      } catch (error) {
        onChange(conflict.id, { status: "idle", error: error instanceof Error ? error.message : "Image upload failed" });
      }
    }

    if (ready.length === 0) return;
    try {
      const response = await fetch("/api/saved-products/update-from-qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: ready.map(({ conflict, image, r2Image, replaceImage }) => ({
            barcode: conflict.barcode,
            newData: conflict.newData,
            image,
            replaceImage,
            ...(r2Image !== undefined ? { r2Image } : {}),
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Product update failed");

      const results = Array.isArray(data.results) ? data.results : [];
      const successes = results.filter((result: any) => result.success);
      const successBarcodes = new Set(successes.map((result: any) => result.barcode));
      const resolved = ready.filter(({ conflict }) => successBarcodes.has(conflict.barcode)).map(({ conflict, image, r2Image, replaceImage }) => ({
        id: conflict.id,
        barcode: conflict.barcode,
        newData: conflict.newData,
        image,
        ...(r2Image !== undefined
          ? { r2Image }
          : !replaceImage && Object.prototype.hasOwnProperty.call(conflict.currentProduct, "r2Image")
            ? { r2Image: String(conflict.currentProduct.r2Image || "") }
            : {}),
      }));
      results.filter((result: any) => !result.success).forEach((result: any) => {
        const conflict = ready.find((item) => item.conflict.barcode === result.barcode)?.conflict;
        if (conflict) onChange(conflict.id, { status: "idle", error: result.error || "Update failed" });
      });
      onResolved(resolved);
      setSummary(`${resolved.length} product${resolved.length === 1 ? "" : "s"} updated successfully${results.length > resolved.length ? `; ${results.length - resolved.length} failed` : ""}.`);
    } catch (error) {
      ready.forEach(({ conflict }) => onChange(conflict.id, { status: "idle", error: error instanceof Error ? error.message : "Update failed" }));
    }
  };

  const handleAll = async () => {
    setUpdatingAll(true);
    setSummary("");
    await updateConflicts(conflicts);
    setUpdatingAll(false);
  };

  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !updatingAll) onClose(); }}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="qr-update-title">
      <header className={styles.header}>
        <div><h2 id="qr-update-title">Product Update Review</h2><p>{conflicts.length} product{conflicts.length === 1 ? "" : "s"} require review</p></div>
        <div className={styles.actions}><button className={`${styles.button} ${styles.primary}`} disabled={updatingAll || conflicts.length === 0} onClick={handleAll}>Update All Products</button><button className={styles.button} disabled={updatingAll} onClick={onClose}>Close</button></div>
      </header>
      <div className={styles.body}>
        {summary && <p className={styles.success}>{summary}</p>}
        {conflicts.map((conflict) => {
          const busy = conflict.status === "updating";
          const preview = conflict.imageChoice === "new" ? conflict.newImagePreview : conflict.currentImage;
          return <article className={styles.card} key={conflict.id}>
            <h3>Barcode: {conflict.barcode}</h3>
            <table className={styles.comparison}><thead><tr><th>Field</th><th>Current Product</th><th>New QR Product</th></tr></thead><tbody>
              {QR_PRODUCT_FIELDS.map((field) => { const changed = conflict.changedFields.includes(field); return <tr key={field}><td>{LABELS[field]}</td><td className={changed ? styles.changed : undefined}>{String(conflict.currentProduct.data?.[field] ?? "—")}</td><td className={changed ? styles.changed : undefined}>{String(conflict.newData[field] || "—")}</td></tr>; })}
            </tbody></table>
            <div className={styles.imageGrid}>
              <div><strong>Current Image</strong><div className={styles.imageBox}>{conflict.currentImage ? <img src={conflict.currentImage} alt={`Current product ${conflict.barcode}`} /> : "No current image"}</div></div>
              <div className={styles.options}><strong>Image Option</strong>
                <label><input type="radio" checked={conflict.imageChoice === "existing"} disabled={busy} onChange={() => onChange(conflict.id, { imageChoice: "existing", error: "" })} />Keep Existing Image</label>
                <label><input type="radio" checked={conflict.imageChoice === "new"} disabled={busy} onChange={() => onChange(conflict.id, { imageChoice: "new", error: "" })} />Upload New Image</label>
                {conflict.imageChoice === "new" && <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (conflict.newImagePreview?.startsWith("blob:")) URL.revokeObjectURL(conflict.newImagePreview); onChange(conflict.id, { newImageFile: file, newImagePreview: URL.createObjectURL(file), error: "" }); }} />}
                {preview && conflict.imageChoice === "new" && <div className={styles.imageBox}><img src={preview} alt={`Replacement preview ${conflict.barcode}`} /></div>}
                <button className={`${styles.button} ${styles.primary}`} disabled={busy || updatingAll} onClick={() => updateConflicts([conflict])}>{busy ? "Updating…" : "Update Product"}</button>
                {conflict.error && <p className={styles.error}>{conflict.error}</p>}
              </div>
            </div>
          </article>;
        })}
      </div>
    </section>
  </div>;
}
