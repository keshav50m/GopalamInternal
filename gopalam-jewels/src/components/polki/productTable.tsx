// 

import React, { useState, useEffect } from "react";
import { applyDiscount } from "@/utils/applyDiscount";
import {
  buildCloudinaryDeliveryUrl,
  CLOUDINARY_THUMBNAIL_TRANSFORMATION,
} from "@/utils/cloudinaryDelivery";
import ProviderAwareImage from "@/components/ProviderAwareImage";

const hasDisplayValue = (value: unknown) =>
  value !== null && value !== undefined && value !== "";

const formatDiscountedPrice = (value: unknown, discountPercent: number) => {
  if (!hasDisplayValue(value)) return "";

  const discountedValue = applyDiscount(value, discountPercent);
  return Number.isFinite(Number(discountedValue))
    ? Math.round(Number(discountedValue))
    : "";
};

const formatDiscountedSILVER = (value: unknown, discountPercent: number) => {
  if (!hasDisplayValue(value)) return "";

  const discountedValue = applyDiscount(value, discountPercent);
  return Number.isFinite(Number(discountedValue))
    ? Number(discountedValue).toFixed(2)
    : "";
};

export default function ProductTable({
  rows,
  setRows,
  handleQRScan,
  handleManualBarcode,
  handleBarcodeLookup,
  handleImage,
  handleRemoveImage,
  lastQRRef,
  lastBarcodeRef,
  totals,
  setSelectedImage,
  priceDiscountPercent,
  usdDiscountPercent
}: any) {
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  useEffect(() => { setPage(lastPage); }, [lastPage]);
  const currentPage = Math.min(page, lastPage);
  return (<>
    <div style={{display:"flex", gap:12, alignItems:"center", marginBottom:12}}>
      <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
      <span>Page {currentPage + 1} of {lastPage + 1} · {rows.length} rows</span>
      <button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button>
    </div>
    <table>
      <thead>
        <tr>
          <th>Image</th>
          <th>QR Code</th>
          <th>Barcode</th>
          <th>ITEM</th>
          <th>LOT NO.</th>
          <th>PUWAI</th>
          <th>NET WT.</th>
          <th>GROSSWT.</th>
          <th>TAG</th>
          <th>LABOUR PER GRM</th>
          <th>LABOUR + PUWAI</th>
          <th>SILVER</th>
          <th>FINAL</th>
          <th>Action</th>
        </tr>
      </thead>

      <tbody>
        {rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((row: any, offset: number) => { const i = currentPage * pageSize + offset; return (
          <tr
            key={i}
            style={{
              contentVisibility: "auto",
              containIntrinsicSize: "140px",
            }}
          >

            {/* IMAGE */}
            <td>
              <input
                type="file"
                accept="image/*"
                id={`file-${i}`}
                style={{ display: "none" }}
                onChange={(e) =>
                  e.target.files && handleImage(i, e.target.files[0])
                }
              />

              <label htmlFor={`file-${i}`} style={{
                boxSizing: "border-box",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "78px",
                height: "22px",
                padding: "2px 6px",
                fontSize: "11px",
                background: "#eee",
                borderRadius: "4px",
                cursor: "pointer",
                whiteSpace: "nowrap"
              }}>
                Choose File
              </label>

              {row.previewUrl || row.imageUrl ? (
                <ProviderAwareImage
                    alt={`Product ${row.barcode || row.data?.ITEM || "image"}`}
                    primaryUrl={buildCloudinaryDeliveryUrl(
                      row.previewUrl || row.imageUrl,
                      CLOUDINARY_THUMBNAIL_TRANSFORMATION
                    )}
                    fallbackUrl={buildCloudinaryDeliveryUrl(
                      row.fallbackImageUrl || "",
                      CLOUDINARY_THUMBNAIL_TRANSFORMATION
                    )}
                    loading="lazy"
                    decoding="async"
                    width="80"
                    style={{
                      marginTop: "8px", borderRadius: "6px",
                      cursor: "pointer",
                      display: "block"
                    }}
                    onClick={() => setSelectedImage({
                      primaryUrl: row.previewUrl || row.imageUrl,
                      fallbackUrl: row.fallbackImageUrl || "",
                    })}
                  />
              ) : (
                <div style={{ fontSize: "12px", color: "#888", marginTop: "6px" }}>
                  No file selected
                </div>
              )}
              {row.previewUrl || row.imageUrl ? (
                <button
                  type="button"
                  disabled={!row.barcode || row.__removingImage}
                  onClick={() => handleRemoveImage(i)}
                  style={{
                    boxSizing: "border-box",
                    display: "block",
                    width: "78px",
                    height: "22px",
                    marginTop: "6px",
                    padding: "2px 3px",
                    fontSize: "9px",
                    lineHeight: "normal",
                    color: "white",
                    background: "#dc2626",
                    border: "none",
                    borderRadius: "4px",
                    cursor: row.barcode && !row.__removingImage ? "pointer" : "not-allowed",
                    opacity: row.__removingImage ? 0.65 : 1,
                    whiteSpace: "nowrap"
                  }}
                >
                  {row.__removingImage ? "Removing…" : "Remove Image"}
                </button>
              ) : null}
            </td>

            {/* QR */}
            <td>
              <input
                ref={i === rows.length - 1 ? lastQRRef : null}
                value={row.qrCode}
                onChange={(e) => handleQRScan(i, e.target.value)}
                placeholder="Scan QR Code Here"
                style={{ width: "260px" }}
              />
            </td>

            {/* BARCODE */}
            <td>
              <input
                ref={i === rows.length - 1 ? lastBarcodeRef : null}
                value={row.barcode}
                onChange={(e) => handleManualBarcode(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  handleBarcodeLookup(i, e.currentTarget.value);
                }}
                placeholder="Enter Barcode"
                style={{ width: "100px" }}
              />
            </td>

            {["ITEM", "LOT NO.", "PUWAI", "NET WT.", "GROSSWT.", "TAG", "LABOUR PER GRM", "LABOUR + PUWAI", "SILVER", "FINAL"].map(field => <td key={field}>{field === "FINAL" ? formatDiscountedPrice(row.data?.[field], priceDiscountPercent) : field === "SILVER" ? formatDiscountedSILVER(row.data?.[field], usdDiscountPercent) : row.data?.[field]}</td>)}

            <td>
              <button onClick={() => {
                const updated = rows.filter((_: any, idx: number) => idx !== i);
                setRows(updated.length ? updated : [{
                  qrCode: "",
                  barcode: "",
                  imageUrl: "",
                  previewUrl: "",
                  data: null
                }]);
              }} style={{
                backgroundColor: "#ef4444",
                color: "white",
                border: "none",
                padding: "6px 12px",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: "bold"
              }}>
                Remove
              </button>
            </td>

          </tr>
        ); })}
      </tbody>

      <tfoot><tr><td colSpan={13}>Products: {totals.count} · Gross: {totals.totalGross.toFixed(3)} · Net: {totals.totalStoneWt.toFixed(3)} · Puwai: {totals.totalDai.toFixed(2)} · Final: {totals.totalPrice} · Silver: {totals.totalSILVER.toFixed(2)}</td></tr></tfoot>
    </table></>
  );
}
