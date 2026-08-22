"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import QRUpdateReview, { type QRUpdateConflict } from "@/components/QRUpdateReview";
import { resolveProductImage } from "@/utils/resolveProductImage";
import { normalizeBarcode } from "@/utils/normalizeBarcode";
import { getChangedQRFields, parseQRCode } from "@/utils/qrProductData";

type Props = { setRows: React.Dispatch<React.SetStateAction<any[]>> };

const normalizeItemNo = (value: unknown) =>
  String(value ?? "").trim().toUpperCase();

export default function QRCodeExcelUpload({ setRows }: Props) {
  const [conflicts, setConflicts] = useState<QRUpdateConflict[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const workbook = XLSX.read(await file.arrayBuffer());
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet);
    const uniqueByBarcode = new Map<string, { qrString: string; parsed: ReturnType<typeof parseQRCode>; barcode: string }>();

    json.forEach((row: any) => {
      const qrString = String(row.qrCode || "").trim();
      const parsed = parseQRCode(qrString);
      const barcode = normalizeBarcode(parsed.BARCODE);
      if (barcode) uniqueByBarcode.set(barcode, { qrString, parsed: { ...parsed, BARCODE: barcode }, barcode });
    });
    const parsedRows = [...uniqueByBarcode.values()];
    if (parsedRows.length === 0) {
      alert("No valid QR rows were found in this Excel file.");
      event.target.value = "";
      return;
    }

    const importId = crypto.randomUUID();
    setRows((previous) => [
      ...previous,
      ...parsedRows.map(({ qrString, parsed, barcode }) => ({
        qrCode: qrString, barcode, data: parsed, imageUrl: "", previewUrl: "",
        __qrExcelImportId: importId,
      })),
    ]);

    try {
      const response = await fetch("/api/saved-products/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          barcodes: parsedRows.map((row) => row.barcode),
          itemNos: parsedRows.map((row) => row.parsed.ITEMNO),
        }),
      });
      const lookupData = await response.json();
      if (!response.ok) throw new Error(lookupData.error || "QR lookup failed");

      const matchedProducts = Array.isArray(lookupData.products) ? lookupData.products : [];
      const productsByBarcode = new Map(matchedProducts.map((product: any) => [normalizeBarcode(product.barcode), product]));
      const itemImages = lookupData.itemImages || {};
      const nextConflicts: QRUpdateConflict[] = [];

      parsedRows.forEach(({ parsed, barcode }) => {
        const currentProduct: any = productsByBarcode.get(barcode);
        if (!currentProduct) return;
        const changedFields = getChangedQRFields(currentProduct.data, parsed);
        if (changedFields.length === 0) return;
        nextConflicts.push({
          id: `${importId}:${barcode}`,
          barcode,
          currentProduct,
          newData: parsed,
          currentImage: resolveProductImage(currentProduct, matchedProducts),
          changedFields: [...changedFields],
          imageChoice: "existing",
          newImageFile: null,
          status: "idle",
        });
      });
      const conflictByBarcode = new Map(nextConflicts.map((conflict) => [conflict.barcode, conflict]));

      setRows((currentRows) => currentRows.map((row) => {
        if (row.__qrExcelImportId !== importId) return row;
        const barcode = normalizeBarcode(row.barcode);
        const match: any = productsByBarcode.get(barcode);
        const conflict = conflictByBarcode.get(barcode);
        const itemNo = normalizeItemNo(row.data?.ITEMNO);
        const fallbackProduct = { barcode, data: row.data, imageCatalogueImage: itemImages[itemNo] || "" };
        const resolvedImage = resolveProductImage(match || fallbackProduct, matchedProducts);
        const updatedRow = {
          ...row,
          data: match?.data || row.data,
          imageUrl: row.imageUrl || row.previewUrl || resolvedImage,
          previewUrl: row.previewUrl || row.imageUrl || resolvedImage,
          ...(conflict ? { __qrUpdateConflictId: conflict.id } : {}),
        };
        delete updatedRow.__qrExcelImportId;
        return updatedRow;
      }));
      setConflicts((current) => [...current, ...nextConflicts]);
    } catch (error) {
      console.error("QR Excel lookup failed:", error);
      setRows((currentRows) => currentRows.map((row) => {
        if (row.__qrExcelImportId !== importId) return row;
        const updatedRow = { ...row };
        delete updatedRow.__qrExcelImportId;
        return updatedRow;
      }));
      alert("QR rows were added, but saved product images could not be loaded. Please try again.");
    } finally {
      event.target.value = "";
    }
  };

  const changeConflict = (id: string, patch: Partial<QRUpdateConflict>) =>
    setConflicts((current) => current.map((conflict) => conflict.id === id ? { ...conflict, ...patch } : conflict));

  const resolveConflicts = (resolved: Array<{ id: string; barcode: string; newData: any; image: string; r2Image?: string }>) => {
    const resolvedById = new Map(resolved.map((item) => [item.id, item]));
    setRows((currentRows) => currentRows.map((row) => {
      const result = resolvedById.get(row.__qrUpdateConflictId);
      if (!result) return row;
      const updatedRow = {
        ...row,
        barcode: result.barcode,
        data: result.newData,
        imageUrl: result.image,
        previewUrl: result.image,
        ...(Object.prototype.hasOwnProperty.call(result, "r2Image")
          ? { r2Image: String(result.r2Image || "") }
          : {}),
      };
      delete updatedRow.__qrUpdateConflictId;
      return updatedRow;
    }));
    setConflicts((current) => current.filter((conflict) => !resolvedById.has(conflict.id)));
  };

  return <div>
    <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} style={{ border: "1px solid #ccc", padding: "6px", borderRadius: "6px", background: "white", cursor: "pointer" }} />
    {conflicts.length > 0 && <button type="button" onClick={() => setReviewOpen(true)} style={{ display: "block", marginTop: "8px", border: 0, borderRadius: "6px", padding: "8px 12px", background: "#c9a84c", color: "white", fontWeight: 700, cursor: "pointer" }}>Review Updates ({conflicts.length})</button>}
    <QRUpdateReview conflicts={conflicts} open={reviewOpen && conflicts.length > 0} onClose={() => setReviewOpen(false)} onChange={changeConflict} onResolved={resolveConflicts} />
  </div>;
}
