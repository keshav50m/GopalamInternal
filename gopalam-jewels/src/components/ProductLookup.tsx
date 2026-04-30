"use client";
import { useState, useEffect, useRef } from "react";
import { calculateTotals } from "@/utils/calculateTotals";

export default function ProductPanel() {
  const [rows, setRows] = useState<any[]>([
    { qrCode: "", barcode: "", imageUrl: "", previewUrl: "", data: null },
  ]);

  const [savedProducts, setSavedProducts] = useState<any[]>([]);
  const lastQRRef = useRef<HTMLInputElement>(null);
  const lastBarcodeRef = useRef<HTMLInputElement>(null);
  const [focusField, setFocusField] = useState<"qr" | "barcode">("qr");

  useEffect(() => {
    fetchSavedProducts();
  }, []);

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

  // const handleQRScan = (index: number, value: string) => {
  //   const updated = [...rows];
  //   updated[index].qrCode = value;

  //   let match = null;

  //   // First priority: Check in savedProducts (MongoDB)
  //   if (value.includes(",")) {
  //     const barcode = value.split(",")[0].trim();
  //     match = savedProducts.find(p => String(p.barcode).trim() === barcode);
  //   }

  //   if (match) {
  //     // Load data + saved image from MongoDB
  //     updated[index].barcode = match.barcode;
  //     updated[index].data = match.data;
  //     updated[index].imageUrl = match.image || "";

  //     // Show saved image as preview
  //     if (match.image) {
  //       updated[index].previewUrl = match.image;
  //     }
  //   } 
  //   // If not found in DB, parse from QR code
  //   else if (value.includes(",") && value.split(",").length >= 4) {
  //     const parsed = parseQRCode(value);
  //     updated[index].barcode = parsed.BARCODE;
  //     updated[index].data = parsed;
  //   } else {
  //     updated[index].barcode = "";
  //     updated[index].data = null;
  //   }

  //   setRows(updated);

  //   // ✅ Only add one new row when complete scan is detected
  // if (index === rows.length - 1 && value.includes(",") && value.split(",").length >= 4) {
  //   setTimeout(() => {
  //     setRows((prevRows) => {
  //       if (prevRows.length === index + 1) {
  //         return [...prevRows, { qrCode: "", barcode: "", imageUrl: "", previewUrl: "", data: null }];
  //       }
  //       return prevRows;
  //     });
  //   }, 180);
  // }
  // };

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
      updated[index].barcode = match.barcode;
      updated[index].data = match.data;
      updated[index].imageUrl = match.image || "";

      // Show image in preview
      if (match.image) {
        updated[index].previewUrl = match.image;
      }
    } else if (parts.length >= 6) {   // Increased threshold for safety
      const parsed = parseQRCode(value);
      updated[index].barcode = parsed.BARCODE;
      updated[index].data = parsed;

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
            return [...prevRows, { qrCode: "", barcode: "", imageUrl: "", previewUrl: "", data: null }];
          }
          return prevRows;
        });
      }, 300);
    }

    setRows(updated);
  };

  // Auto focus on newest row
  useEffect(() => {
    if (rows.length > 0) {
      setTimeout(() => {
        if (focusField === "qr") {
          lastQRRef.current?.focus();
        } else {
          lastBarcodeRef.current?.focus();
        }
      }, 300);
    }
  }, [rows.length]);

  // Adding this for barcode manual input in case QR code is not scanning properly. This allows users to type or paste the barcode and it will fetch data from saved products if available. 
  const handleManualBarcode = (index: number, value: string) => {
    const updated = [...rows];
    updated[index].barcode = value;

    // Search in saved products
    const match = savedProducts.find(p => String(p.barcode).trim() === value.trim());

    if (match) {
      updated[index].data = match.data;
      updated[index].imageUrl = match.image || "";
      if (match.image) {
        updated[index].previewUrl = match.image;
      }
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
              { qrCode: "", barcode: "", imageUrl: "", previewUrl: "", data: null }
            ];
          }
          return prevRows;
        });
      }, 300);
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

  const uploadToCloudinary = async (file: File, index: number) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
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

  const saveAll = async () => {
    const toSave = rows.filter(r => r.barcode && r.data).map(r => ({
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

  // const compressImage = (src: string, quality = 0.5, maxWidth = 600): Promise<string> => {
  //   return new Promise((resolve) => {
  //     const img = new Image();
  //     img.crossOrigin = "anonymous";
  //     img.src = src;

  //     img.onload = () => {
  //       const canvas = document.createElement("canvas");
  //       const scale = maxWidth / img.width;
  //       canvas.width = maxWidth;
  //       canvas.height = img.height * scale;

  //       const ctx = canvas.getContext("2d");
  //       ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);

  //       const compressed = canvas.toDataURL("image/jpeg", quality);
  //       resolve(compressed);
  //     };
  //   });
  // };




  // const exportPDF = async () => {
  //   const { default: jsPDF } = await import("jspdf");
  //   const pdf = new jsPDF("p", "mm", "a4");

  //   let y = 20;
  //   const rowHeight = 28;

  //   const colX = { image: 12, barcode: 45, item: 68, stone: 92, gross: 115, stoneWt: 135, dai: 155, price: 175, usd: 190, size: 215 };

  //   pdf.setFontSize(8.5);
  //   pdf.setFont("helvetica", "bold");

  //   pdf.text("Image", colX.image, y);
  //   pdf.text("Barcode", colX.barcode, y);
  //   pdf.text("Item No", colX.item, y);
  //   pdf.text("Stone", colX.stone, y);
  //   pdf.text("Gross", colX.gross, y);
  //   pdf.text("St Wt", colX.stoneWt, y);
  //   pdf.text("DAI", colX.dai, y);
  //   pdf.text("Price", colX.price, y);
  //   pdf.text("USD", colX.usd, y);
  //   pdf.text("Size", colX.size, y);

  //   y += 8;
  //   pdf.setFont("helvetica", "normal");

  //   for (const row of rows) {
  //     if (!row.data) return;
  //     const d = row.data;

  //     pdf.rect(8, y, 195, rowHeight);
  //     const imgSrc = row.imageUrl || row.previewUrl;
  //     if (imgSrc) {
  //       const compressedImg = await compressImage(imgSrc, 0.5, 600);
  //       pdf.addImage(compressedImg, "JPEG", colX.image, y + 3, 32, 22, undefined, "FAST");
  //     }

  //     const centerY = y + rowHeight / 2 + 2;

  //     pdf.text(String(row.barcode || ""), colX.barcode, centerY);
  //     pdf.text(String(d.ITEMNO || ""), colX.item, centerY);
  //     pdf.text(String(d["STONE NAME"] || ""), colX.stone, centerY);
  //     pdf.text(String(d["GROSS WT"] || ""), colX.gross, centerY);
  //     pdf.text(String(d["STONE WT"] || ""), colX.stoneWt, centerY);
  //     pdf.text(String(d["DAI WT"] || ""), colX.dai, centerY);
  //     pdf.text(String(d["TAG PRICE"] || ""), colX.price, centerY);
  //     pdf.text(String(d.USD || ""), colX.usd, centerY);
  //     pdf.text(String(d.SIZE || "").slice(0, 12), colX.size, centerY);

  //     y += rowHeight + 5;
  //     if (y > 265) {
  //       pdf.addPage();
  //       y = 20;
  //     }
  //   };

  //   pdf.save("products.pdf");
  // };

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
  const totals = calculateTotals(rows);
  return (
    <div>
      <h2>Barcode Scanner Mode</h2>
      <p style={{ color: "#28a745", fontWeight: "bold" }}>
        Scan QR Code continuously • One row per scan
      </p>

      <table>
        <thead>
          <tr>
            <th>Image</th>
            <th>QR Code</th>
            <th>Barcode</th>
            <th>Item No</th>
            <th>Stone</th>
            <th>Gross</th>
            <th>StoneWt</th>
            <th>DAI</th>
            <th>Price</th>
            <th>USD</th>
            <th>Size</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {/* <td>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => e.target.files && handleImage(i, e.target.files[0])}
                />
                {row.previewUrl && (
                  <div style={{ marginTop: "8px" }}>
                    <img src={row.previewUrl} alt="preview" width="80" style={{ borderRadius: "6px" }} />
                  </div>
                )}
              </td> */}
              <td>
                {/* Hidden file input */}
                <input
                  type="file"
                  accept="image/*"
                  id={`file-${i}`}
                  style={{ display: "none" }}
                  onChange={(e) => e.target.files && handleImage(i, e.target.files[0])}
                />

                {/* Custom button */}
                <label
                  htmlFor={`file-${i}`}
                  style={{
                    display: "inline-block",
                    padding: "2px 6px",          // 🔻 reduced padding
                    fontSize: "11px",           // 🔻 smaller text
                    lineHeight: "1",            // 🔻 prevent extra height
                    whiteSpace: "nowrap",       // ✅ force single line
                    background: "#eee",
                    borderRadius: "4px",
                    cursor: "pointer"
                  }}
                >
                  Choose File
                </label>

                {/* Image preview OR fallback text */}
                {row.previewUrl || row.imageUrl ? (
                  <div style={{ marginTop: "8px" }}>
                    <img
                      src={row.previewUrl || row.imageUrl}
                      alt="preview"
                      width="80"
                      style={{ borderRadius: "6px" }}
                    />
                  </div>
                ) : (
                  <div style={{ fontSize: "12px", color: "#888", marginTop: "6px" }}>
                    No file selected
                  </div>
                )}
              </td>
              <td>
                <input
                  ref={i === rows.length - 1 ? lastQRRef : null}
                  value={row.qrCode}
                  onChange={(e) => handleQRScan(i, e.target.value)}
                  placeholder="Scan QR Code Here"
                  style={{ width: "260px" }}
                />
              </td>
              {/* <td>{row.barcode}</td> */}
              <td>
                <input
                  ref={i === rows.length - 1 ? lastBarcodeRef : null}
                  value={row.barcode}
                  onChange={(e) => handleManualBarcode(i, e.target.value)}
                  placeholder="Enter Barcode"
                  style={{ width: "100px" }}
                />
              </td>
              <td>{row.data?.ITEMNO}</td>
              <td>{row.data?.["STONE NAME"]}</td>
              <td>{row.data?.["GROSS WT"]}</td>
              <td>{row.data?.["STONE WT"]}</td>
              <td>{row.data?.["DAI WT"]}</td>
              <td>{row.data?.["TAG PRICE"]}</td>
              <td>{row.data?.USD}</td>
              <td>{row.data?.SIZE}</td>
              <td>
                <button onClick={() => {
                  const updated = rows.filter((_, idx) => idx !== i);
                  setRows(updated.length ? updated : [{ qrCode: "", barcode: "", imageUrl: "", previewUrl: "", data: null }]);
                }}
                  style={{
                    backgroundColor: "#ef4444",
                    color: "white",
                    border: "none",
                    padding: "6px 12px",
                    borderRadius: "4px",
                    cursor: "pointer"
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: "bold", borderTop: "2px solid black" }}>
            <td></td> {/* Image */}
            <td></td> {/* QR */}
            <td></td> {/* Barcode */}
            <td></td> {/* Item No */}
            <td></td> {/* Stone */}

            <td>{totals.totalGross.toFixed(3)}</td>
            <td>{totals.totalStoneWt.toFixed(2)}</td>
            <td>{totals.totalDai.toFixed(2)}</td>
            <td>{totals.totalPrice}</td>
            <td>{totals.totalUSD.toFixed(2)}</td>

            <td></td> {/* Size */}
            <td></td> {/* Action (if exists) */}
          </tr>
        </tfoot>
      </table>
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
      <div style={{ marginTop: "20px", display: "flex", gap: "12px" }}>
        <button onClick={saveAll} style={{
          backgroundColor: "#28a745",
          color: "white",
          padding: "12px 24px",
          border: "none",
          borderRadius: "6px",
          fontSize: "16px",
          fontWeight: "bold",
          cursor: "pointer"
        }}>
          💾 Save All Products
        </button>
        <button onClick={() => setShowPopup(true)}

          style={{
            backgroundColor: "#3b82f6",
            color: "white",
            padding: "12px 24px",
            border: "none",
            borderRadius: "6px",
            fontSize: "16px",
            fontWeight: "bold",
            cursor: "pointer"
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

              <div style={{ marginTop: "15px" }}>
                <button
                  onClick={async () => {
                    const { generatePDF } = await import("@/utils/generatePDF");
                    generatePDF(rows, selectedFields);
                    setShowPopup(false);
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
            setRows(prev => [...prev, { qrCode: "", barcode: "", imageUrl: "", previewUrl: "", data: null }]);
          }}
          style={{
            backgroundColor: "#64748b",
            color: "white",
            padding: "12px 20px",
            border: "none",
            borderRadius: "6px",
            fontSize: "16px",
            fontWeight: "bold",
            cursor: "pointer"
          }}
        >
          + Add Product
        </button>
      </div>
    </div>
  );
}