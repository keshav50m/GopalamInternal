"use client";
import { useState } from "react";

export default function ProductPanel({ products }: any) {
  const [rows, setRows] = useState([
    { barcode: "", image: "", data: null },
  ]);

  // ADD ROW
  const addRow = () => {
    setRows([...rows, { barcode: "", image: "", data: null }]);
  };

  // REMOVE ROW
  const removeRow = (index: number) => {
    const updated = rows.filter((_, i) => i !== index);
    setRows(updated.length ? updated : [{ barcode: "", image: "", data: null }]);
  };

  // BARCODE SEARCH
  const handleBarcode = (index: number, value: string) => {
    const match = products.find(
      (p: any) => String(p["BARCODE"]).trim() === value.trim()
    );

    const updated = [...rows];
    updated[index].barcode = value;
    updated[index].data = match || null;
    setRows(updated);
  };

  // IMAGE UPLOAD
  const handleImage = (index: number, file: File) => {
    const updated = [...rows];
    updated[index].image = URL.createObjectURL(file);
    setRows(updated);
  };

  // ✅ FIXED PDF
  const exportPDF = async () => {
    const { default: jsPDF } = await import("jspdf");
    const pdf = new jsPDF("p", "mm", "a4");

    let y = 20;
    const rowHeight = 26;

    const colX = {
      image: 12,
      barcode: 45,
      item: 60,
      stone: 90,
      gross: 115,
      stoneWt: 128,
      dai: 140,
      price: 152,
      usd: 165,
      size: 178,
    };

    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");

    // HEADER
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

      // IMAGE (no overlap)
      if (row.image) {
        pdf.addImage(row.image, "JPEG", colX.image, y + 2, 32, 20);
      }

      const centerY = y + rowHeight / 2 + 1;

      const itemNo =
        d["ITEMNO."] || d["ITEMNO"] || d["ITEM NO"] || "";

      pdf.text(String(row.barcode || ""), colX.barcode, centerY);
      pdf.text(String(itemNo), colX.item, centerY);
      pdf.text(String(d["STONE NAME"] || ""), colX.stone, centerY);
      pdf.text(String(d["GROSS WT"] || ""), colX.gross, centerY);
      pdf.text(String(d["STONE WT"] || ""), colX.stoneWt, centerY);
      pdf.text(String(d["DAI WT"] || ""), colX.dai, centerY);
      pdf.text(String(d["TAG PRICE"] || ""), colX.price, centerY);

      // USD COLUMN
      pdf.text(
        String(d["USD"] || d["US$"] || d["USD PRICE"] || ""),
        colX.usd,
        centerY
      );

      pdf.text(String(d["SIZE"] || "").slice(0, 8), colX.size, centerY);

      y += rowHeight + 4;

      // NEW PAGE IF NEEDED
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
                  onChange={(e) =>
                    e.target.files && handleImage(i, e.target.files[0])
                  }
                />
              </td>

              <td>
                <input
                  value={row.barcode}
                  onChange={(e) =>
                    handleBarcode(i, e.target.value)
                  }
                />
              </td>

              <td>{row.data?.["ITEMNO."]}</td>
              <td>{row.data?.["STONE NAME"]}</td>
              <td>{row.data?.["GROSS WT"]}</td>
              <td>{row.data?.["STONE WT"]}</td>
              <td>{row.data?.["DAI WT"]}</td>
              <td>{row.data?.["TAG PRICE"]}</td>
              <td>{row.data?.["USD"]}</td>
              <td>{row.data?.["SIZE"]}</td>

              <td>
                <button onClick={() => removeRow(i)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="actions">
        <button className="primary" onClick={addRow}>
          + Add Product
        </button>

        <button className="primary" onClick={exportPDF}>
          Download PDF
        </button>
      </div>
    </div>
  );
}