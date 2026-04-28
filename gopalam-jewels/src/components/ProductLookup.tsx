"use client";
import { useState, useEffect, useRef } from "react";

export default function ProductPanel() {
  const [rows, setRows] = useState<any[]>([
    { barcode: "", image: "", data: null, imageUrl: "" },
  ]);

  const [savedProducts, setSavedProducts] = useState<any[]>([]);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSavedProducts();
    setTimeout(() => barcodeInputRef.current?.focus(), 500);
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

  // Parse Scanned Barcode
  const parseBarcode = (str: string) => {
    const parts = str.split(",").map(p => p.trim());
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

  // Upload image to Cloudinary
  const uploadToCloudinary = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", "gopalam_jewels"); // You can change this

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload`,
      { method: "POST", body: formData }
    );

    const data = await res.json();
    return data.secure_url;
  };

  const handleImage = async (index: number, file: File) => {
    try {
      const imageUrl = await uploadToCloudinary(file);
      const updated = [...rows];
      updated[index].imageUrl = imageUrl;
      setRows(updated);
    } catch (err) {
      alert("Image upload failed");
      console.error(err);
    }
  };

  const handleBarcodeScan = (index: number, value: string) => {
    if (!value) return;

    const parsedData = parseBarcode(value);

    const updated = [...rows];
    updated[index].barcode = value;
    updated[index].data = parsedData;

    setRows(updated);

    // Auto add next row
    setTimeout(() => {
      setRows(prev => [...prev, { barcode: "", image: "", data: null, imageUrl: "" }]);
    }, 150);
  };

  const saveAll = async () => {
    const productsToSave = rows
      .filter(r => r.barcode && r.data)
      .map(r => ({
        barcode: r.barcode.trim(),
        image: r.imageUrl || "",           // Now storing Cloudinary URL
        data: r.data,
      }));

    if (productsToSave.length === 0) return alert("No products to save");

    try {
      const res = await fetch("/api/saved-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: productsToSave }),
      });

      if (res.ok) {
        alert(`✅ ${productsToSave.length} products saved successfully!`);
        fetchSavedProducts();
      } else {
        alert("Failed to save");
      }
    } catch (err) {
      alert("Error saving products");
    }
  };

  const exportPDF = async () => {
    const { default: jsPDF } = await import("jspdf");
    const pdf = new jsPDF("p", "mm", "a4");
    // ... (keep your existing PDF logic)
    let y = 20;
    const rowHeight = 26;
    const colX = { image: 12, barcode: 45, item: 60, stone: 90, gross: 115, stoneWt: 128, dai: 140, price: 152, usd: 165, size: 178 };

    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.text("Image", colX.image, y);
    pdf.text("Barcode", colX.barcode, y);
    pdf.text("Item No", colX.item, y);
    pdf.text("Stone", colX.stone, y);
    pdf.text("Gross", colX.gross, y);
    pdf.text("St Wt", colX.stoneWt, y);
    pdf.text("DAI", colX.dai, y);
    pdf.text("Price", colX.price, y);
    pdf.text("USD", colX.usd, y);
    pdf.text("Size", colX.size, y);

    y += 8;
    pdf.setFont("helvetica", "normal");

    rows.forEach((row) => {
      if (!row.data) return;
      const d = row.data;
      pdf.rect(8, y, 195, rowHeight);

      if (row.imageUrl) {
        pdf.addImage(row.imageUrl, "JPEG", colX.image, y + 2, 32, 20);
      }

      const centerY = y + rowHeight / 2 + 1;
      const itemNo = d.ITEMNO || d["ITEMNO."] || "";

      pdf.text(String(row.barcode || ""), colX.barcode, centerY);
      pdf.text(String(itemNo), colX.item, centerY);
      pdf.text(String(d["STONE NAME"] || ""), colX.stone, centerY);
      pdf.text(String(d["GROSS WT"] || ""), colX.gross, centerY);
      pdf.text(String(d["STONE WT"] || ""), colX.stoneWt, centerY);
      pdf.text(String(d["DAI WT"] || ""), colX.dai, centerY);
      pdf.text(String(d["TAG PRICE"] || ""), colX.price, centerY);
      pdf.text(String(d.USD || ""), colX.usd, centerY);
      pdf.text(String(d.SIZE || "").slice(0, 8), colX.size, centerY);

      y += rowHeight + 4;
      if (y > 270) {
        pdf.addPage();
        y = 20;
      }
    });

    pdf.save("products.pdf");
  };

  return (
    <div>
      <h2>Barcode Scanner Mode</h2>
      <p style={{ color: "#28a745", fontWeight: "bold" }}>
        Scan continuously • Auto adds new row
      </p>

      <table>
        <thead>
          <tr>
            <th>Image</th>
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
              <td>
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={(e) => e.target.files && handleImage(i, e.target.files[0])} 
                />
                {row.imageUrl && <img src={row.imageUrl} width="70" alt="preview" />}
              </td>
              <td>
                <input
                  ref={i === 0 ? barcodeInputRef : null}
                  value={row.barcode}
                  onChange={(e) => handleBarcodeScan(i, e.target.value)}
                  placeholder="Scan Barcode Here"
                  style={{ width: "180px" }}
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
                  setRows(updated.length ? updated : [{ barcode: "", image: "", data: null, imageUrl: "" }]);
                }}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: "20px", display: "flex", gap: "12px" }}>
        <button onClick={saveAll} style={{ backgroundColor: "#28a745", color: "white", padding: "10px 16px" }}>
          💾 Save All Products
        </button>
        <button onClick={exportPDF} style={{ padding: "10px 16px" }}>
          Download PDF
        </button>
      </div>
    </div>
  );
}