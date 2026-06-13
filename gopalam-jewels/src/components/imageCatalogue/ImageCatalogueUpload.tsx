"use client";

import { useState, ChangeEvent } from "react";
import styles from "./ImageCatalogue.module.css";
import { uploadImageToCloudinary } from "./imageUpload";

type CatalogueUploadRow = {
  id: string;
  file: File | null;
  itemNo: string;
  previewUrl: string;
};

const createEmptyRow = (): CatalogueUploadRow => ({
  id: `${Date.now()}-${Math.random()}`,
  file: null,
  itemNo: "",
  previewUrl: "",
});

export default function ImageCatalogueUpload() {
  const [rows, setRows] = useState<CatalogueUploadRow[]>([createEmptyRow()]);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const saveImageCatalogueItem = async (itemNo: string, image: string) => {
    const res = await fetch("/api/image-catalogue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemNo, image }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Image catalogue save failed");
    }
  };

  const updateRow = (id: string, updates: Partial<CatalogueUploadRow>) => {
    setRows((prevRows) =>
      prevRows.map((row) => (row.id === id ? { ...row, ...updates } : row))
    );
  };

  const fetchImageByItemNo = async (
    id: string,
    itemNo: string
  ) => {
    if (!itemNo.trim()) return;

    try {
      const res = await fetch(
        `/api/image-catalogue?itemNo=${encodeURIComponent(
          itemNo.trim()
        )}`
      );

      const data = await res.json();

      if (data?.image) {
        updateRow(id, {
          previewUrl: data.image,
        });

        setRows((prevRows) => {
          const currentRow = prevRows.find((r) => r.id === id);

          // Only add a new row if this is the last row
          if (
            currentRow &&
            prevRows[prevRows.length - 1]?.id === id
          ) {
            return [...prevRows, createEmptyRow()];
          }

          return prevRows;
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleFileChange = (id: string, file: File | null) => {
    const previewUrl = file ? URL.createObjectURL(file) : "";
    updateRow(id, { file, previewUrl });
  };

  const handleExcelUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];

    if (!file) return;

    try {
      setError("");
      setMessage("");

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(
        "/api/image-catalogue/excel",
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Excel upload failed"
        );
      }

      const newRows = data.rows.map(
        (row: any) => ({
          id: `${Date.now()}-${Math.random()}`,
          file: null,
          itemNo: row.itemNo,
          previewUrl: row.image || "",
        })
      );

      setRows(
        newRows.length
          ? [...newRows, createEmptyRow()]
          : [createEmptyRow()]
      );

      setMessage(
        `${newRows.length} unique Item Nos loaded`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Excel upload failed"
      );
    }
  };

  const handleAddRow = () => {
    setRows((prevRows) => [...prevRows, createEmptyRow()]);
    setMessage("");
    setError("");
  };

  const handleRemoveRow = (id: string) => {
    setRows((prevRows) => {
      const updatedRows = prevRows.filter((row) => row.id !== id);
      return updatedRows.length ? updatedRows : [createEmptyRow()];
    });
    setMessage("");
    setError("");
  };

  const handleRemoveAll = () => {
    setRows([createEmptyRow()]);
    setMessage("");
    setError("");
  };

  const handleUploadAll = async () => {
    setMessage("");
    setError("");

    const invalidRowIndex = rows.findIndex((row) => !row.file || !row.itemNo.trim());

    if (invalidRowIndex !== -1) {
      setError(`Row ${invalidRowIndex + 1}: image and Item No are required.`);
      return;
    }

    try {
      setIsUploading(true);

      for (const row of rows) {
        if (!row.file) continue;

        const imageUrl = await uploadImageToCloudinary(row.file);
        await saveImageCatalogueItem(row.itemNo.trim(), imageUrl);
      }

      setMessage(`${rows.length} image${rows.length === 1 ? "" : "s"} uploaded successfully.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className={styles.card}>
      {/* <div style={{ marginBottom: "20px" }}>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleExcelUpload}
          disabled={isUploading}
        />
      </div> */}
      <div
        style={{
          marginBottom: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <label
          style={{
            fontSize: "18px",
            fontWeight: 700,
            color: "#43391f",
          }}
        >
          Barcode Excel Upload
        </label>

        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleExcelUpload}
          disabled={isUploading}
        />
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.catalogueTable}>
          <thead>
            <tr>
              <th>Image</th>
              <th>Item No</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td style={{ verticalAlign: "middle" }}>
                  <div className={styles.imageCell}>
                    <label className={styles.filePicker}>
                      Upload
                      <input
                        type="file"
                        accept="image/*"
                        disabled={isUploading}
                        style={{ display: "none" }}
                        onChange={(event) =>
                          handleFileChange(
                            row.id,
                            event.target.files?.[0] || null
                          )
                        }
                      />
                    </label>
                    {row.previewUrl ? (
                      <img
                        className={styles.thumbnail}
                        src={row.previewUrl}
                        alt={`Preview ${index + 1}`}
                      />
                    ) : (
                      <span className={styles.noPreview}>No image selected</span>
                    )}
                  </div>
                </td>
                <td>
                  {/* <input
                    className={styles.textInput}
                    type="text"
                    value={row.itemNo}
                    disabled={isUploading}
                    onChange={(event) => {
                      updateRow(row.id, {
                        itemNo: event.target.value,
                      });
                    }}
                    onBlur={() =>
                      fetchImageByItemNo(
                        row.id,
                        row.itemNo
                      )
                    }
                    placeholder="Enter Item No"
                  /> */}
                  <input
                    className={styles.textInput}
                    type="text"
                    value={row.itemNo}
                    disabled={isUploading}
                    onChange={(event) => {
                      const value = event.target.value;

                      updateRow(row.id, {
                        itemNo: value,
                      });

                      if (value.trim().length >= 3) {
                        fetchImageByItemNo(row.id, value);
                      }
                    }}
                    placeholder="Enter Item No"
                  />
                </td>
                <td style={{ verticalAlign: "middle", textAlign: "center" }}>
                  <button
                    className={styles.removeButton}
                    disabled={isUploading}
                    onClick={() => handleRemoveRow(row.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.actionRow}>
        <button
          className={styles.button}
          disabled={isUploading}
          onClick={handleUploadAll}
        >
          {isUploading ? "Uploading..." : "Upload All Images"}
        </button>
        <button
          className={styles.secondaryButton}
          disabled={isUploading}
          onClick={handleAddRow}
        >
          + Add Image
        </button>
        <button
          className={styles.removeButton}
          disabled={isUploading}
          onClick={handleRemoveAll}
        >
          Remove All
        </button>
      </div>

      {message ? <div className={styles.success}>{message}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
    </div>
  );
}
