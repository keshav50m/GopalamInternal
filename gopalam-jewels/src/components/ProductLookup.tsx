"use client";
import { useState, useEffect, useRef } from "react";
import { calculateTotals } from "@/utils/calculateTotals";
import ProductTable from "@/components/productTable";
import ExcelUpload from "@/components/ExcelUpload";
import QRCodeExcelUpload from "@/components/QRCodeExcelUpload";
import { resolveProductImage } from "@/utils/resolveProductImage";

const createEmptyRow = () => ({
  qrCode: "",
  barcode: "",
  imageUrl: "",
  previewUrl: "",
  data: null,
});

const normalizeItemNo = (value: unknown) =>
  String(value || "").trim().toUpperCase();

const hasRowImage = (row: any) =>
  Boolean(String(row.imageUrl || row.previewUrl || "").trim());

const getUniqueItemNoRows = (rows: any[]) => {
  const uniqueRows: any[] = [];
  const rowIndexByIdentity = new Map<string, number>();

  rows.forEach((row, index) => {
    const itemNo = normalizeItemNo(row.data?.ITEMNO);
    const barcode = normalizeItemNo(row.barcode);
    const identity = itemNo || `BARCODE:${barcode || index}`;
    const existingIndex = rowIndexByIdentity.get(identity);

    if (existingIndex === undefined) {
      rowIndexByIdentity.set(identity, uniqueRows.length);
      uniqueRows.push(row);
      return;
    }

    if (!hasRowImage(uniqueRows[existingIndex]) && hasRowImage(row)) {
      uniqueRows[existingIndex] = row;
    }
  });

  return uniqueRows;
};

export default function ProductPanel() {
  const [rows, setRows] = useState<any[]>([createEmptyRow()]);

  const [savedProducts, setSavedProducts] = useState<any[]>([]);
  const lastQRRef = useRef<HTMLInputElement>(null);
  const lastBarcodeRef = useRef<HTMLInputElement>(null);
  const previousRowsLengthRef = useRef(rows.length);
  const hasLoadedScannerRowsRef = useRef(false);
  const skipNextScannerRowsSaveRef = useRef(false);
  const [focusField, setFocusField] = useState<"qr" | "barcode">("qr");
  const [companyName, setCompanyName] = useState("");
  const [pdfVersion, setPdfVersion] = useState<"version1" | "version2">("version1");
  const [uniqueItemNoForPDF, setUniqueItemNoForPDF] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [imageFilter, setImageFilter] =
    useState<"all" | "present" | "missing">("all");

  useEffect(() => {
    fetchSavedProducts();
  }, []);

  useEffect(() => {
    const clearScannerRowsOnRefresh = () => {
      sessionStorage.removeItem("scannerRows");
    };

    window.addEventListener("beforeunload", clearScannerRowsOnRefresh);

    return () => {
      window.removeEventListener("beforeunload", clearScannerRowsOnRefresh);
    };
  }, []);

  useEffect(() => {
    try {
      const storedRows = sessionStorage.getItem("scannerRows");

      if (storedRows) {
        const parsedRows = JSON.parse(storedRows);

        if (Array.isArray(parsedRows) && parsedRows.length > 0) {
          setRows(parsedRows);
          previousRowsLengthRef.current = parsedRows.length;
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      hasLoadedScannerRowsRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedScannerRowsRef.current) return;

    if (skipNextScannerRowsSaveRef.current) {
      skipNextScannerRowsSaveRef.current = false;
      return;
    }

    sessionStorage.setItem("scannerRows", JSON.stringify(rows));
  }, [rows]);

  useEffect(() => {
    if (savedProducts.length === 0) return;

    setRows((currentRows) => {
      const lookupProducts = [...currentRows, ...savedProducts];
      let changed = false;

      const nextRows = currentRows.map((row) => {
        if (row.imageUrl || row.previewUrl) return row;

        const resolvedImage = resolveProductImage(row, lookupProducts);
        if (!resolvedImage) return row;

        changed = true;
        return {
          ...row,
          imageUrl: resolvedImage,
          previewUrl: resolvedImage,
        };
      });

      return changed ? nextRows : currentRows;
    });
  }, [rows, savedProducts]);

  const fetchSavedProducts = async () => {
    try {
      const res = await fetch("/api/saved-products");
      if (res.ok) {
        const data = await res.json();
        setSavedProducts(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const parseQRCode = (fullString: string) => {
    const parts = fullString.split(",").map(p => p.trim());
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

  const handleQRScan = (index: number, value: string) => {
    const updated = [...rows];
    updated[index].qrCode = value;
    let match = null;
    // Only process when we have a full QR code (at least 6-7 parts)
    const parts = value.split(",").map(p => p.trim());

    // Check saved products first (MongoDB)
    if (value.includes(",")) {
      const barcode = value.split(",")[0].trim();
      match = savedProducts.find(p => String(p.barcode).trim() === barcode);
    }

    if (match) {
      // ✅ Load saved data + image
      const matchedImage = resolveProductImage(match, savedProducts);
      updated[index].barcode = match.barcode;
      updated[index].data = match.data;
      updated[index].imageUrl = matchedImage;
      updated[index].previewUrl = matchedImage;
    } else if (parts.length >= 6) {   // Increased threshold for safety
      const parsed = parseQRCode(value);
      const matchedImage = resolveProductImage(
        { barcode: parsed.BARCODE, data: parsed },
        savedProducts
      );
      updated[index].barcode = parsed.BARCODE;
      updated[index].data = parsed;
      updated[index].imageUrl = matchedImage;
      updated[index].previewUrl = matchedImage;

    } else {
      // Partial input - just update QR, don't parse or add row
      updated[index].barcode = "";
      updated[index].data = null;
    }
    setFocusField("qr");
    // Auto add new row only after full valid scan
    if (index === rows.length - 1 && value.includes(",") && value.split(",").length >= 4) {
      setTimeout(() => {
        setRows((prevRows) => {
          if (prevRows.length === index + 1) {
            return [...prevRows, createEmptyRow()];
          }
          return prevRows;
        });
      }, 1000);
    }

    setRows(updated);
  };

  // Auto focus on newest row
  useEffect(() => {
    const previousRowsLength = previousRowsLengthRef.current;
    previousRowsLengthRef.current = rows.length;

    if (rows.length <= previousRowsLength) return;

    if (rows.length > 0) {
      const timeout = setTimeout(() => {
        if (focusField === "qr") {
          lastQRRef.current?.focus({ preventScroll: true });
        } else {
          lastBarcodeRef.current?.focus({ preventScroll: true });
        }
      }, 1000);

      return () => clearTimeout(timeout);
    }
  }, [rows.length, focusField]);

  // Adding this for barcode manual input in case QR code is not scanning properly. This allows users to type or paste the barcode and it will fetch data from saved products if available. 
  const handleManualBarcode = (index: number, value: string) => {
    const updated = [...rows];
    updated[index].barcode = value;

    // Search in saved products
    const match = savedProducts.find(p => String(p.barcode).trim() === value.trim());

    if (match) {
      const matchedImage = resolveProductImage(match, savedProducts);
      updated[index].data = match.data;
      updated[index].imageUrl = matchedImage;
      updated[index].previewUrl = matchedImage;
    } else {
      updated[index].data = null;
      updated[index].imageUrl = "";
      updated[index].previewUrl = "";
    }
    setFocusField("barcode");

    // ✅ AUTO ADD NEW ROW (same as QR)
    if (index === rows.length - 1 && value.trim() !== "") {
      setTimeout(() => {
        setRows((prevRows) => {
          if (prevRows.length === index + 1) {
            return [
              ...prevRows,
              createEmptyRow()
            ];
          }
          return prevRows;
        });
      }, 2000);
    }

    setRows(updated);
  };

  const handleImage = (index: number, file: File) => {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);

    const updated = [...rows];
    updated[index].previewUrl = previewUrl;
    setRows(updated);

    uploadToCloudinary(file, index);
  };

  const compressImage = (file: File): Promise<File> => {
    return new Promise((resolve) => {
      const img = new Image();
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;

        ctx?.drawImage(img, 0, 0);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }

            const compressedFile = new File(
              [blob],
              file.name,
              {
                type: "image/jpeg",
                lastModified: Date.now(),
              }
            );

            resolve(compressedFile);
          },
          "image/jpeg",
          0.6 // compression quality
        );
      };

      img.src = URL.createObjectURL(file);
    });
  };

  const uploadToCloudinary = async (file: File, index: number) => {
    try {
      const compressedFile = await compressImage(file);

      const formData = new FormData();
      formData.append("file", compressedFile);
      formData.append("upload_preset", "gopalam_jewels");

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload`,
        { method: "POST", body: formData }
      );
      const data = await res.json();
      if (data.secure_url) {
        const updated = [...rows];
        updated[index].imageUrl = data.secure_url;
        setRows(updated);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const saveAll = async (rowsToSave: any[] = rows) => {

    console.log(
      rows.map(r => ({
        barcode: r.barcode,
        imageUrl: r.imageUrl
      }))
    );
    
    const toSave = rowsToSave.filter(r => r.barcode && r.data).map(r => ({
      barcode: r.barcode,
      image: r.imageUrl || "",
      data: r.data,
    }));

    if (toSave.length === 0) return alert("No products to save");

    try {
      const res = await fetch("/api/saved-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: toSave }),
      });

      if (res.ok) {
        alert(`✅ ${toSave.length} products saved!`);
        fetchSavedProducts();
      }
    } catch (err) {
      alert("Save failed");
    }
  };

  const [selectedFields, setSelectedFields] = useState({
    image: true,
    barcode: true,
    item: true,
    stone: true,
    gross: true,
    stoneWt: true,
    dai: true,
    price: true,
    usd: true,
    size: true,
  });

  const [showPopup, setShowPopup] = useState(false);
  const isValidProductRow = (row: any) =>
    Boolean(row.barcode || row.qrCode || row.data);

  const validProductRows = rows.filter(isValidProductRow);
  const allProductsCount = validProductRows.length;
  const imagesPresentCount = validProductRows.filter((row) => row.imageUrl).length;
  const imagesMissingCount = validProductRows.filter((row) => !row.imageUrl).length;

  const filteredRows = rows
    .map((row, originalIndex) => ({ ...row, __originalIndex: originalIndex }))
    .filter((row) => {
      if (!isValidProductRow(row)) return true;
      if (imageFilter === "present") return row.imageUrl;
      if (imageFilter === "missing") return !row.imageUrl;
      return true;
    });

  const getOriginalRowIndex = (displayIndex: number) =>
    filteredRows[displayIndex]?.__originalIndex ?? displayIndex;

  const stripDisplayMetadata = (row: any) => {
    const { __originalIndex, ...cleanRow } = row;
    return cleanRow;
  };

  const preparedPdfRows = filteredRows.map(stripDisplayMetadata);
  const pdfRowsPreview = uniqueItemNoForPDF
    ? getUniqueItemNoRows(preparedPdfRows)
    : preparedPdfRows;

  const handleDisplayedRowsChange = (nextRows: any[] | ((prevRows: any[]) => any[])) => {
    if (typeof nextRows === "function") {
      setRows((prevRows) => nextRows(prevRows).map(stripDisplayMetadata));
      return;
    }

    if (imageFilter === "all") {
      setRows(nextRows.map(stripDisplayMetadata));
      return;
    }

    const visibleIndexes = new Set(
      filteredRows
        .map((row) => row.__originalIndex)
        .filter((index) => typeof index === "number")
    );

    const remainingVisibleIndexes = new Set(
      nextRows
        .map((row) => row.__originalIndex)
        .filter((index) => typeof index === "number")
    );

    setRows((prevRows) =>
      prevRows.filter((_, index) =>
        !visibleIndexes.has(index) || remainingVisibleIndexes.has(index)
      )
    );
  };

  const removeAllProducts = () => {
    const confirmed = window.confirm("Are you sure you want to remove all products?");

    if (!confirmed) return;

    skipNextScannerRowsSaveRef.current = true;
    sessionStorage.removeItem("scannerRows");
    setImageFilter("all");
    setRows([createEmptyRow()]);
  };

  const imageFilterButtons = [
    { key: "all", label: `All Products (${allProductsCount})` },
    { key: "present", label: `Images Present (${imagesPresentCount})` },
    { key: "missing", label: `Images Missing (${imagesMissingCount})` },
  ] as const;

  const totals = calculateTotals(filteredRows);
  return (
    <div>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "10px"
      }}>
        <div>
          <h2>Barcode Scanner Mode</h2>
          <p style={{ color: "#28a745", fontWeight: "bold" }}>
            Scan QR Code continuously • One row per scan
          </p>
        </div>

        {/* <div>
          <h3>Excel Upload</h3>
          <ExcelUpload setRows={setRows} savedProducts={savedProducts} />
        </div> */}

        <div
          style={{
            display: "flex",
            gap: "20px",
            alignItems: "flex-start",
          }}
        >
          <div>
            <h3>Barcode Excel</h3>
            <ExcelUpload
              setRows={setRows}
              savedProducts={savedProducts}
            />
          </div>

          <div>
            <h3>QR Excel</h3>
            <QRCodeExcelUpload
              setRows={setRows}
              savedProducts={savedProducts}
            />
          </div>
        </div>
      </div>

      <ProductTable
        rows={filteredRows}
        setRows={handleDisplayedRowsChange}
        handleQRScan={(index: number, value: string) => handleQRScan(getOriginalRowIndex(index), value)}
        handleManualBarcode={(index: number, value: string) => handleManualBarcode(getOriginalRowIndex(index), value)}
        handleImage={(index: number, file: File) => handleImage(getOriginalRowIndex(index), file)}
        lastQRRef={lastQRRef}
        lastBarcodeRef={lastBarcodeRef}
        totals={totals}
        setSelectedImage={setSelectedImage}
      />
      {/* 🔥 TOTAL ROW ALIGNED WITH TABLE */}

      <div style={{
        marginTop: "20px",
        padding: "12px",
        border: "1px solid #ccc",
        borderRadius: "6px",
        background: "#f9fafb",
        display: "flex",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "12px"
      }}>
        <strong>Total Products: {totals.count}</strong>
      </div>

      <div style={{
        marginTop: "20px",
        display: "flex",
        gap: "12px",
        flexWrap: "wrap",
        alignItems: "center"
      }}>
        {imageFilterButtons.map((button) => {
          const isActive = imageFilter === button.key;

          return (
            <button
              key={button.key}
              onClick={() => setImageFilter(button.key)}
              style={{
                backgroundColor: isActive ? "#3b82f6" : "#64748b",
                color: "white",
                padding: "10px 14px",
                border: "none",
                borderRadius: "6px",
                fontSize: "14px",
                fontWeight: "bold",
                cursor: "pointer",
                minHeight: "42px",
                whiteSpace: "nowrap"
              }}
            >
              {button.label}
            </button>
          );
        })}
        <button onClick={() => saveAll(filteredRows.map(stripDisplayMetadata))} style={{
          backgroundColor: "#28a745",
          color: "white",
          padding: "10px 14px",
          border: "none",
          borderRadius: "6px",
          fontSize: "14px",
          fontWeight: "bold",
          cursor: "pointer",
          minHeight: "42px",
          whiteSpace: "nowrap"
        }}>
          💾 Save All Products
        </button>
        <button onClick={() => setShowPopup(true)}

          style={{
            backgroundColor: "#3b82f6",
            color: "white",
            padding: "10px 14px",
            border: "none",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
            minHeight: "42px",
            whiteSpace: "nowrap"
          }}
        >Download PDF</button>
        {showPopup && (



          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000
          }}>
            <div style={{
              background: "white",
              padding: "20px",
              borderRadius: "8px",
              minWidth: "300px"
            }}>
              <div style={{ marginBottom: "10px" }}>
                <label style={{ display: "block", fontWeight: "bold" }}>
                  Company Name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Enter Company Name"
                  style={{
                    width: "100%",
                    padding: "6px",
                    marginTop: "4px",
                    borderRadius: "4px",
                    border: "1px solid #ccc"
                  }}
                />
              </div>
              <label style={{ display: "block", marginBottom: "10px" }}>
                <input
                  type="checkbox"
                  checked={uniqueItemNoForPDF}
                  onChange={(event) =>
                    setUniqueItemNoForPDF(event.target.checked)
                  }
                />
                Unique Item No
              </label>
              <h3>Select Fields</h3>

              {Object.keys(selectedFields).map((key) => (
                <label key={key} style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    checked={selectedFields[key as keyof typeof selectedFields]}
                    onChange={() =>
                      setSelectedFields(prev => ({
                        ...prev,
                        [key]: !prev[key as keyof typeof prev]
                      }))
                    }
                  />
                  {key}
                </label>
              ))}

              <div style={{ marginTop: "15px", marginBottom: "10px" }}>
                <h3 style={{ marginBottom: "8px" }}>PDF Layout</h3>
                <label style={{ display: "block", marginBottom: "6px" }}>
                  <input
                    type="radio"
                    name="pdf-layout"
                    value="version1"
                    checked={pdfVersion === "version1"}
                    onChange={() => setPdfVersion("version1")}
                  />
                  Version 1 – Table Layout
                </label>
                <label style={{ display: "block" }}>
                  <input
                    type="radio"
                    name="pdf-layout"
                    value="version2"
                    checked={pdfVersion === "version2"}
                    onChange={() => setPdfVersion("version2")}
                  />
                  Version 2 – Catalogue Cards
                </label>
              </div>

              {isGenerating && (
                <div style={{ marginBottom: "15px" }}>
                  <div style={{
                    width: "100%",
                    height: "10px",
                    background: "#e5e7eb",
                    borderRadius: "5px",
                    overflow: "hidden"
                  }}>
                    <div style={{
                      width: `${progress}%`,
                      height: "100%",
                      background: "#3b82f6",
                      transition: "width 0.3s ease"
                    }} />
                  </div>

                  <p style={{ fontSize: "12px", marginTop: "5px" }}>
                    Generating PDF... {progress}%
                  </p>
                </div>
              )}

              <div style={{ marginTop: "15px" }}>
                <p style={{ fontSize: "12px", marginBottom: "8px" }}>
                  PDF Products: {pdfRowsPreview.length}
                </p>
                <button
                  disabled={isGenerating}
                  style={{
                    opacity: isGenerating ? 0.6 : 1,
                    cursor: isGenerating ? "not-allowed" : "pointer"
                  }}
                  onClick={async () => {
                    setIsGenerating(true);
                    setProgress(10);

                    // Fake smooth progress
                    let fakeProgress = 10;
                    const interval = setInterval(() => {
                      fakeProgress += 10;
                      if (fakeProgress < 90) setProgress(fakeProgress);
                    }, 300);

                    const rowsForPdf = filteredRows.map(stripDisplayMetadata);
                    const pdfRows = uniqueItemNoForPDF
                      ? getUniqueItemNoRows(rowsForPdf)
                      : rowsForPdf;

                    if (pdfVersion === "version1") {
                      const { generatePDF } = await import("@/utils/generatePDF");
                      await generatePDF(pdfRows, selectedFields, companyName);
                    } else {
                      const { generatePDFVersion2 } = await import("@/utils/generatePDFVersion2");
                      await generatePDFVersion2(pdfRows, selectedFields, companyName);
                    }

                    clearInterval(interval);
                    setProgress(100);

                    setTimeout(() => {
                      setIsGenerating(false);
                      setShowPopup(false);
                      setProgress(0);
                    }, 500);
                  }}
                >
                  Generate PDF
                </button>

                <button onClick={() => setShowPopup(false)} style={{ marginLeft: "10px" }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        {/* New Manual Add Row Button */}
        <button
          onClick={() => {
            setRows(prev => [...prev, createEmptyRow()]);
          }}
          style={{
            backgroundColor: "#64748b",
            color: "white",
            padding: "10px 14px",
            border: "none",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
            minHeight: "42px",
            whiteSpace: "nowrap"
          }}
        >
          + Add Product
        </button>
      </div>

      <div style={{
        marginTop: "12px",
        display: "flex",
        alignItems: "center"
      }}>
        <button
          onClick={removeAllProducts}
          style={{
            backgroundColor: "#dc2626",
            color: "white",
            padding: "10px 14px",
            border: "none",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
            minHeight: "42px",
            whiteSpace: "nowrap"
          }}
        >
          Remove All Products
        </button>
      </div>

      <button
        onClick={() => {
          window.scrollTo({
            top: 0,
            behavior: "smooth"
          });
        }}
        style={{
          position: "fixed",
          right: "24px",
          bottom: "78px",
          zIndex: 900,
          backgroundColor: "#111827",
          color: "white",
          padding: "12px 16px",
          border: "none",
          borderRadius: "999px",
          fontSize: "14px",
          fontWeight: "bold",
          cursor: "pointer",
          boxShadow: "0 10px 25px rgba(0,0,0,0.25)"
        }}
      >
        ↑ Top
      </button>

      <button
        onClick={() => {
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: "smooth"
          });
        }}
        style={{
          position: "fixed",
          right: "24px",
          bottom: "24px",
          zIndex: 900,
          backgroundColor: "#111827",
          color: "white",
          padding: "12px 16px",
          border: "none",
          borderRadius: "999px",
          fontSize: "14px",
          fontWeight: "bold",
          cursor: "pointer",
          boxShadow: "0 10px 25px rgba(0,0,0,0.25)"
        }}
      >
        ↓ Bottom
      </button>

      {selectedImage && (
        <div
          onClick={() => setSelectedImage(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 2000
          }}
        >
          <img
            src={selectedImage}
            alt="zoom"
            style={{
              maxWidth: "90%",
              maxHeight: "90%",
              borderRadius: "10px",
              boxShadow: "0 0 20px black"
            }}
          />
        </div>
      )}
    </div>
  );
}
