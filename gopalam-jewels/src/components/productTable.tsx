// 

import React from "react";
import { applyDiscount } from "@/utils/applyDiscount";

const hasDisplayValue = (value: unknown) =>
  value !== null && value !== undefined && value !== "";

const formatDiscountedPrice = (value: unknown, discountPercent: number) => {
  if (!hasDisplayValue(value)) return "";

  const discountedValue = applyDiscount(value, discountPercent);
  return Number.isFinite(Number(discountedValue))
    ? Math.round(Number(discountedValue))
    : "";
};

const formatDiscountedUSD = (value: unknown, discountPercent: number) => {
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
  handleImage,
  lastQRRef,
  lastBarcodeRef,
  totals,
  setSelectedImage,
  priceDiscountPercent,
  usdDiscountPercent
}: any) {
  return (
    <table>
      <thead>
        <tr>
          <th>Image</th>
          <th>QR Code</th>
          <th>Barcode</th>
          <th>Item No</th>
          <th>Stone</th>
          <th>Gross</th>
          <th>StoneWt</th>
          <th>DAI</th>
          <th>Price</th>
          <th>USD</th>
          <th>Size</th>
          <th>Action</th>
        </tr>
      </thead>

      <tbody>
        {rows.map((row: any, i: number) => (
          <tr key={i}>

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
                padding: "2px 6px",
                fontSize: "11px",
                background: "#eee",
                borderRadius: "4px",
                cursor: "pointer"
              }}>
                Choose File
              </label>

              {row.previewUrl || row.imageUrl ? (
                <img
                  src={row.previewUrl || row.imageUrl}
                  width="80"
                  style={{
                    marginTop: "8px", borderRadius: "6px",
                    cursor: "pointer",        // ✅ THIS IS KEY
                    display: "block"          // (fix for some browsers)
                  }}
                  onClick={() => setSelectedImage(row.previewUrl || row.imageUrl)}
                />
              ) : (
                <div style={{ fontSize: "12px", color: "#888", marginTop: "6px" }}>
                  No file selected
                </div>
              )}
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
                placeholder="Enter Barcode"
                style={{ width: "100px" }}
              />
            </td>

            <td>{row.data?.ITEMNO}</td>
            <td>{row.data?.["STONE NAME"]}</td>
            <td>{row.data?.["GROSS WT"]}</td>
            <td>{row.data?.["STONE WT"]
              ? parseFloat(row.data["STONE WT"]).toFixed(2)
              : ""}</td>

            {/* ✅ DAI FIX */}
            <td>
              {row.data?.["DAI WT"]
                ? parseFloat(row.data["DAI WT"]).toFixed(2)
                : ""}
            </td>

            <td>
              {formatDiscountedPrice(
                row.data?.["TAG PRICE"],
                priceDiscountPercent
              )}
            </td>
            <td>
              {formatDiscountedUSD(row.data?.USD, usdDiscountPercent)}
            </td>
            <td>{row.data?.SIZE}</td>

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
        ))}
      </tbody>

      {/* TOTALS */}
      <tfoot>
        <tr style={{ fontWeight: "bold", borderTop: "2px solid black" }}>
          <td></td><td></td><td></td><td></td><td></td>

          <td>{totals.totalGross.toFixed(3)}</td>
          <td>{totals.totalStoneWt.toFixed(2)}</td>
          <td>{totals.totalDai.toFixed(2)}</td>
          <td>{totals.totalPrice}</td>
          <td>{totals.totalUSD.toFixed(2)}</td>

          <td></td><td></td>
        </tr>
      </tfoot>
    </table>
  );
}
