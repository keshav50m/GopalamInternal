"use client";
import * as XLSX from "xlsx";

export default function ExcelUpload({ setRows, savedProducts }: any) {
    const handleFileUpload = async (e: any) => {
        const file = e.target.files?.[0];

        console.log("FILE SELECTED", file);

        if (!file) return;

        const data = await file.arrayBuffer();

        const workbook = XLSX.read(data);

        console.log("SHEETS", workbook.SheetNames);

        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        const json = XLSX.utils.sheet_to_json(sheet);

        console.log("EXCEL DATA", json);

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

        console.log("BARCODES", barcodes);

        if (barcodes.length === 0) {
            alert("No barcode column found");
            return;
        }

        setRows((prev: any[]) => {
            const newRows = barcodes.map((code) => {
                const match = savedProducts.find(
                    (p: any) => String(p.barcode).trim() === code
                );

                return {
                    qrCode: "",
                    barcode: code,
                    imageUrl: match?.image || "",
                    previewUrl: match?.image || "",
                    data: match?.data || null,
                };
            });

            console.log("NEW ROWS", newRows);

            return [...prev, ...newRows];
        });
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