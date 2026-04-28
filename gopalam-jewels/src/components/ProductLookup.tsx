"use client";
import { useState, useEffect } from "react";

interface ProductPanelProps {
  products: any[];
  rows: any[];
  setRows: React.Dispatch<React.SetStateAction<any[]>>;
}

export default function ProductPanel({ products, rows, setRows }: ProductPanelProps) {
  
  const [savedProducts, setSavedProducts] = useState<any[]>([]);

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
      console.error("Failed to load saved products:", err);
    }
  };

  const addRow = () => {
    setRows([...rows, { barcode: "", image: "", data: null }]);
  };

  const removeRow = (index: number) => {
    const updated = rows.filter((_, i) => i !== index);
    setRows(updated.length ? updated : [{ barcode: "", image: "", data: null }]);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleImage = async (index: number, file: File) => {
    try {
      const base64 = await fileToBase64(file);
      const updated = [...rows];
      updated[index].image = base64;
      setRows(updated);
    } catch (err) {
      console.error("Image conversion failed", err);
    }
  };

  const handleBarcode = (index: number, value: string) => {
    const trimmed = value.trim();

    let match = savedProducts.find((p: any) =>
      String(p.barcode || "").trim() === trimmed
    );

    if (!match) {
      match = products.find((p: any) =>
        String(p["BARCODE"]).trim() === trimmed
      );
    }

    const updated = [...rows];
    updated[index].barcode = value;

    if (match) {
      updated[index].data = match.data || match;
      if (match.image) updated[index].image = match.image;
    } else {
      updated[index].data = null;
      updated[index].image = "";
    }

    setRows(updated);
  };

  const saveAll = async () => {
    const productsToSave = rows
      .filter((row) => row.barcode?.trim() && row.data)
      .map((row) => ({
        barcode: row.barcode.trim(),
        image: row.image || "",
        data: row.data,
      }));

    if (productsToSave.length === 0) {
      alert("No valid products to save!");
      return;
    }

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
        alert("Failed to save products");
      }
    } catch (err) {
      console.error(err);
      alert("Error saving products");
    }
  };

  const exportPDF = async () => {
    const { default: jsPDF } = await import("jspdf");
    const pdf = new jsPDF("p", "mm", "a4");

    let y = 20;
    const rowHeight = 26;
    const colX = {
      image: 12, barcode: 45, item: 60, stone: 90,
      gross: 115, stoneWt: 128, dai: 140, price: 152,
      usd: 165, size: 178,
    };

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

      if (row.image) pdf.addImage(row.image, "JPEG", colX.image, y + 2, 32, 20);

      const centerY = y + rowHeight / 2 + 1;
      const itemNo = d["ITEMNO."] || d["ITEMNO"] || "";

      pdf.text(String(row.barcode || ""), colX.barcode, centerY);
      pdf.text(String(itemNo), colX.item, centerY);
      pdf.text(String(d["STONE NAME"] || ""), colX.stone, centerY);
      pdf.text(String(d["GROSS WT"] || ""), colX.gross, centerY);
      pdf.text(String(d["STONE WT"] || ""), colX.stoneWt, centerY);
      pdf.text(String(d["DAI WT"] || ""), colX.dai, centerY);
      pdf.text(String(d["TAG PRICE"] || ""), colX.price, centerY);
      pdf.text(String(d["USD"] || d["US$"] || ""), colX.usd, centerY);
      pdf.text(String(d["SIZE"] || "").slice(0, 8), colX.size, centerY);

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
      <h2>Product Panel</h2>

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
                {row.image && (
                  <div style={{ marginTop: "8px" }}>
                    <img src={row.image} alt="preview" width="70" />
                  </div>
                )}
              </td>

              <td>
                <input
                  value={row.barcode}
                  onChange={(e) => handleBarcode(i, e.target.value)}
                  placeholder="Enter Barcode"
                />
              </td>

              <td>{row.data?.["ITEMNO."] || row.data?.["ITEMNO"]}</td>
              <td>{row.data?.["STONE NAME"]}</td>
              <td>{row.data?.["GROSS WT"]}</td>
              <td>{row.data?.["STONE WT"]}</td>
              <td>{row.data?.["DAI WT"]}</td>
              <td>{row.data?.["TAG PRICE"]}</td>
              <td>{row.data?.["USD"] || row.data?.["US$"]}</td>
              <td>{row.data?.["SIZE"]}</td>

              <td>
                <button onClick={() => removeRow(i)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="actions" style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
        <button className="primary" onClick={addRow}>
          + Add Product
        </button>

        <button 
          className="primary" 
          onClick={saveAll}
          style={{ backgroundColor: "#28a745", color: "white" }}
        >
          💾 Save All Products
        </button>

        <button className="primary" onClick={exportPDF}>
          Download PDF
        </button>
      </div>
    </div>
  );
}