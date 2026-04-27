"use client";
import { useState } from "react";
import * as XLSX from "xlsx";

export default function AdminPanel({ setProducts, products }: any) {
  const [preview, setPreview] = useState<any[]>(products || []);

  const handleFile = async (file: File) => {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    setProducts(json);
    setPreview(json);
  };

  return (
    <div>
      <h2>Upload Excel</h2>

      <input
        type="file"
        accept=".xlsx"
        onChange={(e) => {
          if (e.target.files?.[0]) handleFile(e.target.files[0]);
        }}
      />

      <h3 style={{ marginTop: 20 }}>Preview</h3>

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              {preview[0] &&
                Object.keys(preview[0]).map((key) => (
                  <th key={key}>{key}</th>
                ))}
            </tr>
          </thead>

          <tbody>
            {preview.slice(0, 10).map((row, i) => (
              <tr key={i}>
                {Object.values(row).map((val: any, j) => (
                  <td key={j}>{val}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}