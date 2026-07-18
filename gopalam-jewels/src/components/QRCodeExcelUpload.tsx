"use client";

import * as XLSX from "xlsx";
import { resolveProductImage } from "@/utils/resolveProductImage";

type Props = {
    setRows: React.Dispatch<React.SetStateAction<any[]>>;
    savedProducts: any[];
};

export default function QRCodeExcelUpload({
    setRows,
    savedProducts,
}: Props) {

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

        const newRows = json.map((row: any) => {
            const qrString = String(row.qrCode || "").trim();

            const parsed = parseQRCode(qrString);

            const barcode = parsed.BARCODE;

            const match = savedProducts.find(
                (p) => String(p.barcode).trim() === barcode
            );
            const resolvedImage = resolveProductImage(
                match || { barcode, data: parsed },
                savedProducts
            );

            return {
                qrCode: qrString,
                barcode,
                data: parsed,
                imageUrl: resolvedImage,
                previewUrl: resolvedImage,
            };
        });

        setRows((prev) => [...prev, ...newRows]);
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
