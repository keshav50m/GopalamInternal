"use client";
import * as XLSX from "xlsx";
import { resolveProductImageCandidates } from "@/utils/resolveProductImage";
import { normalizeBarcode } from "@/utils/normalizeBarcode";
import PasteImport from "@/components/PasteImport";
import { getPastedLines } from "@/utils/pasteImport";

export default function ExcelUpload({ setRows }: any) {
    const importBarcodes = async (values: string[]) => {
        const barcodes = values.map(normalizeBarcode).filter(Boolean);
        if (barcodes.length === 0) {
            alert("No valid barcodes found");
            return;
        }

        const importId = crypto.randomUUID();
        setRows((prev: any[]) => [
            ...prev,
            ...barcodes.map((barcode) => ({
                qrCode: "", barcode, imageUrl: "", previewUrl: "", data: null,
                __barcodeExcelImportId: importId,
            })),
        ]);

        try {
            const response = await fetch("/api/saved-products/lookup", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ barcodes }),
            });
            const lookupData = await response.json();
            if (!response.ok) throw new Error(lookupData.error || "Barcode lookup failed");
            const matchedProducts = Array.isArray(lookupData.products) ? lookupData.products : [];
            const productsByBarcode = new Map(matchedProducts.map((product: any) => [normalizeBarcode(product.barcode), product]));
            setRows((currentRows: any[]) => currentRows.map((row) => {
                if (row.__barcodeExcelImportId !== importId) return row;
                const match = productsByBarcode.get(normalizeBarcode(row.barcode));
                const resolvedImage = resolveProductImageCandidates(match || { barcode: row.barcode, data: null }, matchedProducts);
                const hasCurrentImage = Boolean(row.imageUrl || row.previewUrl);
                const updatedRow = { ...row, image: resolvedImage.image || row.image || "", r2Image: resolvedImage.r2Image || row.r2Image || "", imageUrl: hasCurrentImage ? row.imageUrl : resolvedImage.primaryUrl, previewUrl: hasCurrentImage ? row.previewUrl || row.imageUrl : resolvedImage.primaryUrl, fallbackImageUrl: hasCurrentImage ? row.fallbackImageUrl || "" : resolvedImage.fallbackUrl, data: (match as any)?.data || null };
                delete updatedRow.__barcodeExcelImportId;
                return updatedRow;
            }));
        } catch (error) {
            console.error("Barcode import lookup failed:", error);
            setRows((currentRows: any[]) => currentRows.map((row) => {
                if (row.__barcodeExcelImportId !== importId) return row;
                const updatedRow = { ...row }; delete updatedRow.__barcodeExcelImportId; return updatedRow;
            }));
            alert("Barcode rows were added, but saved product details could not be loaded. Please try again.");
        }
    };

    const handleFileUpload = async (e: any) => {
        const file = e.target.files?.[0];

        if (!file) return;

        const data = await file.arrayBuffer();

        const workbook = XLSX.read(data);

        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        const json = XLSX.utils.sheet_to_json(sheet);

        const barcodes = json
            .map((row: any) =>
                String(
                    row.barcode ||
                    row.Barcode ||
                    row.BARCODE ||
                    ""
                ).trim()
            )
            .filter(Boolean);

        await importBarcodes(barcodes);
        e.target.value = "";
    };

    return (
        <div>
            <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                style={{
                    border: "1px solid #ccc",
                    padding: "6px",
                    borderRadius: "6px",
                    background: "white",
                    cursor: "pointer"
                }}
            />
            <PasteImport label="Paste barcodes" placeholder={"One barcode per line\n100234\n100235"} onImport={(text) => importBarcodes([...new Set(getPastedLines(text, ["BARCODE"]))])} />
        </div>
    );
}
