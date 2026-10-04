"use client";

import type { RefObject } from "react";

import ProviderAwareImage from "@/components/ProviderAwareImage";
import type { GoldScannerRow } from "@/components/gold/GoldProductLookup";
import { applyDiscount } from "@/utils/applyDiscount";
import styles from "./GoldScanner.module.css";

type Props = {
  rows: GoldScannerRow[];
  lastQRRef: RefObject<HTMLInputElement | null>;
  lastBarcodeRef: RefObject<HTMLInputElement | null>;
  onQRChange: (index: number, value: string) => void;
  onBarcodeChange: (index: number, value: string) => void;
  onBarcodeLookup: (index: number, value: string) => void;
  onImage: (index: number, file: File) => void;
  onRemove: (index: number) => void;
  onPreview: (primaryUrl: string, fallbackUrl: string) => void;
  totals: GoldTotals;
  priceDiscountPercent: number;
  usdDiscountPercent: number;
};

export type GoldTotals = {
  nw: number;
  gw: number;
  stoneWeight: number;
  diamondWeight: number;
  totalTag: number;
  usd: number;
};

const numeric = (value: unknown, decimals = 3) => {
  if (value === "" || value === null || value === undefined) return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(decimals) : String(value);
};

const discounted = (value: unknown, percent: number, decimals: number) =>
  value === "" || value === null || value === undefined
    ? ""
    : numeric(applyDiscount(value, percent), decimals);

export default function GoldProductTable(props: Props) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <colgroup>
          <col style={{ width: "120px" }} />
          <col style={{ width: "130px" }} />
          <col style={{ width: "130px" }} />
          <col style={{ width: "150px" }} />
          <col style={{ width: "80px" }} />
          <col style={{ width: "130px" }} />
          <col style={{ width: "75px" }} />
          <col style={{ width: "75px" }} />
          <col style={{ width: "85px" }} />
          <col style={{ width: "85px" }} />
          <col style={{ width: "95px" }} />
          <col style={{ width: "90px" }} />
          <col style={{ width: "100px" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Image</th><th>QR Code</th><th>Barcode</th><th>Lot No</th>
            <th>Karat</th><th>Stone</th><th>NW</th><th>GW</th>
            <th>ST WT.</th><th>DI WT.</th><th>Total Tag</th><th>US$</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, index) => (
            <tr key={row.id} style={{ contentVisibility: "auto", containIntrinsicSize: "140px" }}>
              <td>
                <input
                  id={`gold-file-${row.id}`}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) props.onImage(index, file);
                    event.target.value = "";
                  }}
                />
                <label className={styles.fileLabel} htmlFor={`gold-file-${row.id}`}>Choose File</label>
                {row.previewUrl || row.imageUrl ? (
                  <ProviderAwareImage
                    className={styles.thumbnail}
                    alt={`Gold product ${row.barcode || row.data?.["LOT NO"] || "image"}`}
                    primaryUrl={row.previewUrl || row.imageUrl}
                    fallbackUrl={row.fallbackImageUrl}
                    loading="lazy"
                    decoding="async"
                    onClick={() => props.onPreview(
                      row.previewUrl || row.imageUrl,
                      row.fallbackImageUrl
                    )}
                  />
                ) : <div className={styles.emptyImage}>No file selected</div>}
              </td>
              <td>
                <input
                  ref={index === props.rows.length - 1 ? props.lastQRRef : null}
                  className={styles.qrInput}
                  type="text"
                  value={row.qrCode}
                  placeholder="Scan Gold QR Code Here"
                  onChange={(event) => props.onQRChange(index, event.target.value)}
                />
              </td>
              <td>
                <input
                  ref={index === props.rows.length - 1 ? props.lastBarcodeRef : null}
                  className={styles.barcodeInput}
                  type="text"
                  value={row.barcode}
                  placeholder="Enter Barcode"
                  onChange={(event) => props.onBarcodeChange(index, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    props.onBarcodeLookup(index, event.currentTarget.value);
                  }}
                />
              </td>
              <td>{row.data?.["LOT NO"]}</td>
              <td>{row.data?.KARAT1}</td>
              <td>{row.data?.["STONE NAME"]}</td>
              <td>{numeric(row.data?.NW)}</td>
              <td>{numeric(row.data?.GW)}</td>
              <td>{numeric(row.data?.["ST WT."], 2)}</td>
              <td>{numeric(row.data?.["DI WT."], 2)}</td>
              <td>{discounted(
                row.data?.["TOTAL TAG"], props.priceDiscountPercent, 0
              )}</td>
              <td>{discounted(
                row.data?.["US$"], props.usdDiscountPercent, 2
              )}</td>
              <td><button className={styles.removeButton} onClick={() => props.onRemove(index)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6}>Totals</td>
            <td>{props.totals.nw.toFixed(3)}</td>
            <td>{props.totals.gw.toFixed(3)}</td>
            <td>{props.totals.stoneWeight.toFixed(2)}</td>
            <td>{props.totals.diamondWeight.toFixed(2)}</td>
            <td>{props.totals.totalTag.toFixed(0)}</td>
            <td>{props.totals.usd.toFixed(2)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
