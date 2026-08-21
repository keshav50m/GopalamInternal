"use client";

import * as XLSX from "xlsx";
import { resolveProductImage } from "@/utils/resolveProductImage";
import { normalizeBarcode } from "@/utils/normalizeBarcode";

type Props = {
    setRows: React.Dispatch<React.SetStateAction<any[]>>;
};

export default function QRCodeExcelUpload({
    setRows,
}: Props) {

    const normalizeItemNo = (value: unknown) =>
        String(value ?? "").trim().toUpperCase();

    const parseQRCode = (fullString: string) => {
        const parts = fullString.split(",").map((p) => p.trim());

        return {
            BARCODE: parts[0] || "",
            ITEMNO: parts[1] || "",
            "STONE NAME": parts[2] || "",
            "GROSS WT": parts[3] || "",
            "STONE WT": parts[4] || "",
            "DAI WT": parts[5] || "",
            "TAG PRICE": parts[6] || "",
            SIZE: parts[7] || "",
            USD: parts[8] || "",
        };
    };

    const handleFileUpload = async (
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file = e.target.files?.[0];

        if (!file) return;

        const data = await file.arrayBuffer();

        const workbook = XLSX.read(data);

        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        const json = XLSX.utils.sheet_to_json(sheet);

        const parsedRows = json.map((row: any) => {
            const qrString = String(row.qrCode || "").trim();
            const parsed = parseQRCode(qrString);

            return { qrString, parsed, barcode: parsed.BARCODE };
        });
        const importId = crypto.randomUUID();
        setRows((prev) => [
            ...prev,
            ...parsedRows.map(({ qrString, parsed, barcode }) => ({
                qrCode: qrString,
                barcode,
                data: parsed,
                imageUrl: "",
                previewUrl: "",
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

            if (!response.ok) {
                throw new Error(lookupData.error || "QR lookup failed");
            }

            const matchedProducts = Array.isArray(lookupData.products)
                ? lookupData.products
                : [];
            const productsByBarcode = new Map(
                matchedProducts.map((product: any) => [
                    normalizeBarcode(product.barcode),
                    product,
                ])
            );
            const itemImages = lookupData.itemImages || {};

            setRows((currentRows) => currentRows.map((row) => {
                if (row.__qrExcelImportId !== importId) return row;

                const match = productsByBarcode.get(
                    normalizeBarcode(row.barcode)
                );
                const itemNo = normalizeItemNo(row.data?.ITEMNO);
                const fallbackProduct = {
                    barcode: row.barcode,
                    data: row.data,
                    imageCatalogueImage: itemImages[itemNo] || "",
                };
                const resolvedImage = resolveProductImage(
                    match || fallbackProduct,
                    matchedProducts
                );
                const hasCurrentImage = Boolean(
                    row.imageUrl || row.previewUrl
                );
                const updatedRow = {
                    ...row,
                    data: (match as any)?.data || row.data,
                    imageUrl: hasCurrentImage ? row.imageUrl : resolvedImage,
                    previewUrl: hasCurrentImage
                        ? row.previewUrl || row.imageUrl
                        : resolvedImage,
                };
                delete updatedRow.__qrExcelImportId;
                return updatedRow;
            }));
        } catch (error) {
            console.error("QR Excel lookup failed:", error);
            setRows((currentRows) => currentRows.map((row) => {
                if (row.__qrExcelImportId !== importId) return row;

                const updatedRow = { ...row };
                delete updatedRow.__qrExcelImportId;
                return updatedRow;
            }));
            alert(
                "QR rows were added, but saved product images could not be loaded. Please try again."
            );
        }
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
        </div>
    );
}
