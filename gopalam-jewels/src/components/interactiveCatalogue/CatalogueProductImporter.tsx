"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import PasteImport from "@/components/PasteImport";
import { getPastedLines } from "@/utils/pasteImport";
import { normalizeBarcode } from "@/utils/normalizeBarcode";
import { parseQRCode } from "@/utils/qrProductData";
import styles from "./InteractiveCatalogue.module.css";

export type ImportedCatalogueProduct = {
  barcode: string;
  itemNo: string;
  stone: string;
  primaryImageUrl: string;
  fallbackImageUrl: string;
  isSold: boolean;
  tagPrice: string;
  usd: string;
};

type Props = {
  disabled?: boolean;
  onProducts: (products: ImportedCatalogueProduct[], missing: string[]) => void;
};

const readFirstSheet = async (file: File) => {
  const workbook = XLSX.read(await file.arrayBuffer());
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
};

export default function CatalogueProductImporter({ disabled, onProducts }: Props) {
  const barcodeFile = useRef<HTMLInputElement>(null);
  const qrFile = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const lookup = async (rawBarcodes: string[]) => {
    const barcodes = [...new Set(rawBarcodes.map(normalizeBarcode).filter(Boolean))];
    if (!barcodes.length) throw new Error("No valid barcodes were found.");
    setBusy(true);
    try {
      const response = await fetch("/api/saved-products/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcodes }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load saved products");
      const products = (Array.isArray(data.products) ? data.products : []).map((product: any) => ({
        barcode: normalizeBarcode(product.barcode),
        itemNo: String(product.data?.ITEMNO || "").trim(),
        stone: String(product.data?.["STONE NAME"] || "").trim(),
        primaryImageUrl: String(product.resolvedImageUrl || product.imageCatalogueResolvedImageUrl || ""),
        fallbackImageUrl: String(product.fallbackImageUrl || product.imageCatalogueFallbackImageUrl || ""),
        isSold: product.isSold === true,
        tagPrice: String(product.data?.["TAG PRICE"] || "").trim(),
        usd: String(product.data?.USD || "").trim(),
      }));
      const found = new Set(products.map((product: ImportedCatalogueProduct) => product.barcode));
      onProducts(products, barcodes.filter((barcode) => !found.has(barcode)));
    } finally {
      setBusy(false);
    }
  };

  const qrBarcodes = (values: string[]) => values.map((value) => normalizeBarcode(parseQRCode(value).BARCODE)).filter(Boolean);
  const safeLookup = async (values: string[]) => {
    try { await lookup(values); }
    catch (error) { window.alert(error instanceof Error ? error.message : "Unable to add products."); }
  };
  const uploadBarcodes = async (file: File) => {
    const rows = await readFirstSheet(file);
    await safeLookup(rows.map((row) => String(row.barcode || row.Barcode || row.BARCODE || Object.values(row)[0] || "")));
  };
  const uploadQrs = async (file: File) => {
    const rows = await readFirstSheet(file);
    await safeLookup(qrBarcodes(rows.map((row) => String(row.qrCode || row.QR_CODE || row["QR Code"] || Object.values(row)[0] || ""))));
  };

  return <div className={styles.importGrid}>
    <PasteImport disabled={disabled || busy} label="QR Paste" placeholder="Paste one complete QR value per line" onImport={(text) => safeLookup(qrBarcodes(getPastedLines(text, ["qrCode", "QR_CODE"])))} />
    <button type="button" className={styles.importButton} disabled={disabled || busy} onClick={() => qrFile.current?.click()}>QR Excel</button>
    <PasteImport disabled={disabled || busy} label="Barcode Paste" placeholder={"One barcode per line\n100234\n100235"} onImport={(text) => safeLookup(getPastedLines(text, ["BARCODE"]))} />
    <button type="button" className={styles.importButton} disabled={disabled || busy} onClick={() => barcodeFile.current?.click()}>Barcode Excel</button>
    <input ref={qrFile} hidden type="file" accept=".xlsx,.xls" onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) await uploadQrs(file); }} />
    <input ref={barcodeFile} hidden type="file" accept=".xlsx,.xls" onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) await uploadBarcodes(file); }} />
    {busy ? <span className={styles.importStatus}>Adding products…</span> : null}
  </div>;
}
