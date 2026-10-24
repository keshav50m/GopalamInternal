"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import PasteImport from "@/components/PasteImport";
import { getPastedLines } from "@/utils/pasteImport";
import { normalizeBarcode } from "@/utils/normalizeBarcode";
import { parseQRCode } from "@/utils/qrProductData";

type Props = { onMarked: (barcodes: string[]) => void };

export default function MarkSold({ onMarked }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const barcodeFile = useRef<HTMLInputElement>(null);
  const qrFile = useRef<HTMLInputElement>(null);

  const mark = async (values: string[], qr: boolean) => {
    const barcodes = [...new Set(values.map((value) => normalizeBarcode(qr ? parseQRCode(value).BARCODE : value)).filter(Boolean))];
    if (!barcodes.length) { setMessage("No valid codes found."); return; }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/saved-products/stock-status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcodes, isSold: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to mark products sold");
      onMarked(result.matchedBarcodes);
      setMessage(`${result.matchedBarcodes.length} products marked sold. ${result.unmatchedBarcodes.length} codes not found.${result.unmatchedBarcodes.length ? ` Not found: ${result.unmatchedBarcodes.join(", ")}` : ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to mark products sold. Please retry.");
    } finally { setBusy(false); }
  };

  const upload = async (event: React.ChangeEvent<HTMLInputElement>, qr: boolean) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer());
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]]);
      const values = rows.map((row) => {
        const key = Object.keys(row).find((key) => key.trim().replace(/[ _-]/g, "").toLowerCase() === (qr ? "qrcode" : "barcode"));
        return String(key ? row[key] ?? "" : "");
      });
      await mark(values, qr);
    } catch { setMessage("Unable to read this Excel file."); }
    finally { event.target.value = ""; }
  };

  return <div style={{ position: "relative", paddingTop: 20, marginLeft: -16, marginRight: 8 }}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{ background: "#537b78", color: "white", padding: "10px 16px", border: "1px solid #466b68", borderRadius: 8, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}>Mark Sold</button>
    {open && <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 50, width: 290, padding: 16, background: "white", border: "1px solid #ddd", borderRadius: 8, boxShadow: "0 4px 16px #0002" }}>
      <p style={{ marginTop: 0 }}>Mark matching saved products as sold.</p>
      <input ref={qrFile} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void upload(event, true)} />
      <input ref={barcodeFile} hidden type="file" accept=".xlsx,.xls" onChange={(event) => void upload(event, false)} />
      <button type="button" disabled={busy} onClick={() => qrFile.current?.click()}>Upload QR Excel</button>
      <button type="button" disabled={busy} onClick={() => barcodeFile.current?.click()}>Upload Barcode Excel</button>
      <PasteImport label="Paste Barcodes" placeholder="One barcode per line" disabled={busy} onImport={(text) => mark(getPastedLines(text, ["BARCODE"]), false)} />
      <PasteImport label="Paste QR Codes" placeholder="One complete QR value per line" disabled={busy} onImport={(text) => mark(getPastedLines(text, ["qrCode", "QR_CODE"]), true)} />
      {busy && <p role="status">Updating sold status…</p>}
      {message && <p role="status" style={{ overflowWrap: "anywhere" }}>{message}</p>}
      <button type="button" onClick={() => setOpen(false)}>Close</button>
    </div>}
  </div>;
}
