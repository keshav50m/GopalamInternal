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

export default function GoldExcelUpload({ mode, onImport }: Props) {
  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const workbook = XLSX.read(await file.arrayBuffer());
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
      });
      const uniqueRows = new Map<string, GoldExcelRow>();

      sourceRows.forEach((sourceRow) => {
        if (mode === "barcode") {
          const barcode = normalizeBarcode(
            sourceRow.BARCODE || sourceRow.Barcode || sourceRow.barcode
          );
          if (barcode) uniqueRows.set(barcode, { barcode, qrCode: "", data: null });
          return;
        }

        const suppliedQR = String(sourceRow.qrCode || sourceRow.QR_CODE || "").trim();
        const data = suppliedQR
          ? parseGoldQRCode(suppliedQR)
          : hasGoldColumns(sourceRow)
            ? normalizeGoldProductData(sourceRow)
            : null;
        if (!data) return;
        const barcode = normalizeBarcode(data.BARCODE);
        if (!barcode) return;
        data.BARCODE = barcode;
        const qrCode = suppliedQR || GOLD_PRODUCT_FIELDS.map((field) => data[field]).join(",");
        uniqueRows.set(barcode, { barcode, qrCode, data });
      });

      if (uniqueRows.size === 0) {
        alert(mode === "barcode"
          ? "No BARCODE column was found in this Excel file."
          : "No valid Gold QR or Gold-schema rows were found in this Excel file.");
        return;
      }

      await onImport([...uniqueRows.values()]);
    } catch (error) {
      console.error("Gold Excel import failed:", error);
      alert("Unable to read this Gold Excel file.");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <input
      className={styles.fileInput}
      type="file"
      accept=".xlsx,.xls"
      aria-label={mode === "barcode" ? "Gold Barcode Excel" : "Gold QR Excel"}
      onChange={handleFile}
    />
  );
}

