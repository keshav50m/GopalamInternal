"use client";
import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { useDropzone } from "react-dropzone";

interface Props {
  onDataLoaded: (data: any[]) => void;
}

export default function AdminPanel({ onDataLoaded }: Props) {
  const [uploadedData, setUploadedData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");

  const processExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const parsed: any[] = XLSX.utils.sheet_to_json(sheet);
        setUploadedData(parsed);
        setColumns(parsed.length > 0 ? Object.keys(parsed[0]) : []);
        onDataLoaded(parsed);
        setStatus(`success:Loaded ${parsed.length} products successfully!`);
      } catch {
        setStatus("error:Error reading file. Please check the format.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setStatus("loading:Processing your file...");
      processExcel(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "text/csv": [".csv"],
    },
  });

  const statusType = status.split(":")[0];
  const statusMsg = status.split(":")[1];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div style={{ background: "white", borderRadius: "16px", padding: "32px", boxShadow: "0 4px 24px rgba(0,0,0,0.06)", border: "1px solid #f0e8d5" }}>
        <h2 style={{ fontFamily: "Playfair Display, serif", fontSize: "24px", fontWeight: 700, color: "#1a1a1a", marginBottom: "8px" }}>
          Data Management
        </h2>
        <p style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", color: "#6B7280", marginBottom: "28px" }}>
          Upload your product Excel or CSV file to enable product lookup.
        </p>

        <div
          {...getRootProps()}
          style={{ border: `2px dashed ${isDragActive ? "#C9A84C" : "#E8C97A"}`, borderRadius: "12px", padding: "48px 24px", textAlign: "center", cursor: "pointer", background: isDragActive ? "#FFFBF0" : "#FFFDF7", transition: "all 0.2s" }}
        >
          <input {...getInputProps()} />
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>📊</div>
          <p style={{ fontFamily: "Inter, sans-serif", fontSize: "16px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>
            {isDragActive ? "Drop your file here..." : "Drag & drop your Excel or CSV file"}
          </p>
          <p style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", color: "#9CA3AF", marginBottom: "20px" }}>
            Supports .xlsx and .csv formats
          </p>
          <button style={{ padding: "10px 24px", background: "linear-gradient(135deg, #9A7A30, #C9A84C)", color: "white", border: "none", borderRadius: "8px", fontFamily: "Inter, sans-serif", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>
            Browse Files
          </button>
        </div>

        {status && (
          <div style={{ marginTop: "16px", padding: "14px 18px", borderRadius: "10px", fontFamily: "Inter, sans-serif", fontSize: "14px", fontWeight: 500, background: statusType === "success" ? "#F0FDF4" : statusType === "error" ? "#FEF2F2" : "#FFFBEB", color: statusType === "success" ? "#16A34A" : statusType === "error" ? "#DC2626" : "#D97706", border: `1px solid ${statusType === "success" ? "#BBF7D0" : statusType === "error" ? "#FECACA" : "#FDE68A"}` }}>
            {statusType === "success" ? "✅ " : statusType === "error" ? "❌ " : "⏳ "}{statusMsg}
          </div>
        )}
      </div>

      {uploadedData.length > 0 && (
        <div style={{ background: "white", borderRadius: "16px", padding: "24px", boxShadow: "0 4px 24px rgba(0,0,0,0.06)", border: "1px solid #f0e8d5", overflowX: "auto" }}>
          <h3 style={{ fontFamily: "Playfair Display, serif", fontSize: "18px", fontWeight: 700, color: "#1a1a1a", marginBottom: "16px" }}>
            Preview — {uploadedData.length} products loaded
          </h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Inter, sans-serif", fontSize: "13px" }}>
            <thead>
              <tr style={{ background: "linear-gradient(135deg, #9A7A30, #C9A84C)" }}>
                {columns.map((col) => (
                  <th key={col} style={{ padding: "12px 16px", color: "white", fontWeight: 600, textAlign: "left", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uploadedData.slice(0, 8).map((row, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "#FFFDF7" : "white", borderBottom: "1px solid #F3F4F6" }}>
                  {columns.map((col) => (
                    <td key={col} style={{ padding: "12px 16px", color: "#374151", whiteSpace: "nowrap" }}>
                      {row[col] ?? "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {uploadedData.length > 8 && (
            <p style={{ fontFamily: "Inter, sans-serif", fontSize: "12px", color: "#9CA3AF", marginTop: "12px" }}>
              Showing 8 of {uploadedData.length} rows
            </p>
          )}
        </div>
      )}
    </div>
  );
}