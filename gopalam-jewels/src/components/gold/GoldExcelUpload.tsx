"use client";

import * as XLSX from "xlsx";

import {
  GOLD_PRODUCT_FIELDS,
  normalizeGoldProductData,
  parseGoldQRCode,
  type GoldProductData,
} from "@/utils/goldProductData";
import { normalizeBarcode } from "@/utils/normalizeBarcode";
import styles from "./GoldScanner.module.css";
import PasteImport from "@/components/PasteImport";
import { getPastedLines } from "@/utils/pasteImport";

export type GoldExcelRow = {
  barcode: string;
  qrCode: string;
  data: GoldProductData | null;
};

type Props = {
  mode: "barcode" | "qr";
  onImport: (rows: GoldExcelRow[]) => void | Promise<void>;
};

const hasGoldColumns = (row: Record<string, unknown>) =>
  GOLD_PRODUCT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(row, field));

const hasGoldBusinessColumns = (row: Record<string, unknown>) =>
  GOLD_PRODUCT_FIELDS.slice(1).some((field) =>
    Object.prototype.hasOwnProperty.call(row, field)
  );

export default function GoldExcelUpload({ mode, onImport }: Props) {
  const importSourceRows = async (sourceRows: Record<string, unknown>[]) => {
    const uniqueRows = new Map<string, GoldExcelRow>();
    sourceRows.forEach((sourceRow) => {
      if (mode === "barcode") {
        const barcode = normalizeBarcode(sourceRow.BARCODE || sourceRow.Barcode || sourceRow.barcode);
        if (barcode) {
          const data = hasGoldBusinessColumns(sourceRow) ? normalizeGoldProductData({ ...sourceRow, BARCODE: barcode }) : null;
          uniqueRows.set(barcode, { barcode, qrCode: "", data });
        }
        return;
      }
      const suppliedQR = String(sourceRow.qrCode || sourceRow.QR_CODE || "").trim();
      const data = suppliedQR ? parseGoldQRCode(suppliedQR) : hasGoldColumns(sourceRow) ? normalizeGoldProductData(sourceRow) : null;
      if (!data) return;
      const barcode = normalizeBarcode(data.BARCODE);
      if (!barcode) return;
      data.BARCODE = barcode;
      const qrCode = suppliedQR || GOLD_PRODUCT_FIELDS.map((field) => data[field]).join(",");
      uniqueRows.set(barcode, { barcode, qrCode, data });
    });
    if (uniqueRows.size === 0) {
      alert(mode === "barcode" ? "No valid barcodes were found." : "No valid Gold QR rows were found.");
      return;
    }
    await onImport([...uniqueRows.values()]);
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const workbook = XLSX.read(await file.arrayBuffer());
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
      });
      await importSourceRows(sourceRows);
    } catch (error) {
      console.error("Gold Excel import failed:", error);
      alert("Unable to read this Gold Excel file.");
    } finally {
      event.target.value = "";
    }
  };

  return <div>
    <input className={styles.fileInput} type="file" accept=".xlsx,.xls" aria-label={mode === "barcode" ? "Gold Barcode Excel" : "Gold QR Excel"} onChange={handleFile} />
    <PasteImport
      label={mode === "barcode" ? "Paste barcodes" : "Paste QR codes"}
      placeholder={mode === "barcode" ? "One barcode per line" : "One complete Gold QR value per line"}
      onImport={(text) => importSourceRows(getPastedLines(text, mode === "barcode" ? ["BARCODE"] : ["qrCode", "QR_CODE"]).map((value) => mode === "barcode" ? { BARCODE: value } : { qrCode: value }))}
    />
  </div>;
}
