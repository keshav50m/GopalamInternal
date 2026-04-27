"use client";
import { useState, useRef, useEffect } from "react";
import jsPDF from "jspdf";

interface ProductEntry {
  serialNumber: string;
  productData: any;
  images: File[];
  videos: File[];
  imagePreviews: string[];
  videoPreviews: string[];
}

interface Props {
  products: any[];
}

export default function ProductLookup({ products }: Props) {
  const [serial, setSerial] = useState("");
  const [entries, setEntries] = useState<ProductEntry[]>([]);
  const [error, setError] = useState("");
  const [found, setFound] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSearch = () => {
    if (!serial.trim()) return;
    if (products.length === 0) {
      setError("No product data loaded. Please upload Excel in Admin Panel.");
      return;
    }
    const match = products.find((p) =>
      Object.values(p).some((v) => String(v).toLowerCase() === serial.toLowerCase())
    );
    if (match) {
      setFound(match);
      setError("");
    } else {
      setFound(null);
      setError(`No product found for serial: "${serial}"`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const addToList = () => {
    if (!found) return;
    const exists = entries.find((e) => e.serialNumber === serial);
    if (exists) { setError("Product already added to list."); return; }
    setEntries([...entries, {
      serialNumber: serial,
      productData: found,
      images: [],
      videos: [],
      imagePreviews: [],
      videoPreviews: [],
    }]);
    setSerial("");
    setFound(null);
    setError("");
    inputRef.current?.focus();
  };

  const handleImageUpload = (index: number, files: FileList | null) => {
    if (!files) return;
    const newEntries = [...entries];
    const fileArray = Array.from(files);
    const previews = fileArray.map((f) => URL.createObjectURL(f));
    newEntries[index].images = [...newEntries[index].images, ...fileArray];
    newEntries[index].imagePreviews = [...newEntries[index].imagePreviews, ...previews];
    setEntries(newEntries);
  };

  const handleVideoUpload = (index: number, files: FileList | null) => {
    if (!files) return;
    const newEntries = [...entries];
    const fileArray = Array.from(files);
    const previews = fileArray.map((f) => URL.createObjectURL(f));
    newEntries[index].videos = [...newEntries[index].videos, ...fileArray];
    newEntries[index].videoPreviews = [...newEntries[index].videoPreviews, ...previews];
    setEntries(newEntries);
  };

  const removeEntry = (index: number) => {
    setEntries(entries.filter((_, i) => i !== index));
  };

  const exportPDF = async () => {
    if (entries.length === 0) return;
    const pdf = new jsPDF("p", "mm", "a4");
    const pageW = 210;
    const pageH = 297;
    const margin = 16;

    for (let i = 0; i < entries.length; i++) {
      if (i > 0) pdf.addPage();
      const entry = entries[i];

      // Gold header bar
      pdf.setFillColor(201, 168, 76);
      pdf.rect(0, 0, pageW, 18, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      pdf.text("GOPALAM JEWELS", margin, 12);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text("www.gopalamjewels.in", pageW - margin, 12, { align: "right" });

      // Product image
      let yPos = 26;
      if (entry.imagePreviews.length > 0) {
        try {
          const img = new Image();
          img.src = entry.imagePreviews[0];
          await new Promise((res) => { img.onload = res; });
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.getContext("2d")?.drawImage(img, 0, 0);
          const imgData = canvas.toDataURL("image/jpeg", 0.8);
          const imgW = 80;
          const imgH = (img.height / img.width) * imgW;
          pdf.addImage(imgData, "JPEG", margin, yPos, imgW, imgH);
          yPos = Math.max(yPos + imgH + 8, yPos);
        } catch {}
      }

      // Product details
      pdf.setTextColor(30, 30, 30);
      pdf.setFontSize(16);
      pdf.setFont("helvetica", "bold");
      pdf.text(`Serial: ${entry.serialNumber}`, margin, yPos + 10);
      yPos += 20;

      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      Object.entries(entry.productData).forEach(([key, value]) => {
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(154, 122, 48);
        pdf.text(`${key}:`, margin, yPos);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(60, 60, 60);
        pdf.text(String(value), margin + 50, yPos);
        yPos += 8;
        if (yPos > pageH - 20) { pdf.addPage(); yPos = 20; }
      });

      // Footer
      pdf.setFillColor(245, 240, 230);
      pdf.rect(0, pageH - 12, pageW, 12, "F");
      pdf.setTextColor(154, 122, 48);
      pdf.setFontSize(8);
      pdf.text(`Product ${i + 1} of ${entries.length}  |  Gopalam Jewels`, pageW / 2, pageH - 4, { align: "center" });
    }

    pdf.save("Gopalam-Jewels-Catalog.pdf");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>

      {/* Search Section */}
      <div style={{ background: "white", borderRadius: "16px", padding: "32px", boxShadow: "0 4px 24px rgba(0,0,0,0.06)", border: "1px solid #f0e8d5" }}>
        <h2 style={{ fontFamily: "Playfair Display, serif", fontSize: "24px", fontWeight: 700, color: "#1a1a1a", marginBottom: "8px" }}>
          Product Lookup
        </h2>
        <p style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", color: "#6B7280", marginBottom: "24px" }}>
          Scan a barcode or enter a serial number manually to find a product.
        </p>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <input
            ref={inputRef}
            type="text"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Scan barcode or type serial number..."
            style={{ flex: 1, minWidth: "260px", padding: "14px 20px", fontSize: "15px", fontFamily: "Inter, sans-serif", border: "2px solid #E8C97A", borderRadius: "10px", outline: "none", background: "#FFFDF7", color: "#1a1a1a", letterSpacing: "0.5px" }}
          />
          <button
            onClick={handleSearch}
            style={{ padding: "14px 28px", background: "linear-gradient(135deg, #9A7A30, #C9A84C)", color: "white", border: "none", borderRadius: "10px", fontFamily: "Inter, sans-serif", fontSize: "14px", fontWeight: 600, cursor: "pointer", letterSpacing: "0.5px" }}
          >
            Search
          </button>
          <button
            onClick={() => { setSerial(""); setFound(null); setError(""); inputRef.current?.focus(); }}
            style={{ padding: "14px 20px", background: "transparent", color: "#9CA3AF", border: "2px solid #E5E7EB", borderRadius: "10px", fontFamily: "Inter, sans-serif", fontSize: "14px", cursor: "pointer" }}
          >
            Clear
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{ marginTop: "16px", padding: "12px 16px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", color: "#DC2626", fontFamily: "Inter, sans-serif", fontSize: "14px" }}>
            {error}
          </div>
        )}

        {/* Found Result */}
        {found && (
          <div style={{ marginTop: "20px", padding: "20px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <span style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", fontWeight: 600, color: "#16A34A" }}>
                Product Found
              </span>
              <button
                onClick={addToList}
                style={{ padding: "8px 20px", background: "linear-gradient(135deg, #9A7A30, #C9A84C)", color: "white", border: "none", borderRadius: "8px", fontFamily: "Inter, sans-serif", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
              >
                + Add to List
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
              {Object.entries(found).map(([key, value]) => (
                <div key={key} style={{ background: "white", borderRadius: "8px", padding: "12px" }}>
                  <p style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", fontWeight: 600, color: "#9A7A30", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>{key}</p>
                  <p style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", color: "#1a1a1a" }}>{String(value)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Product List */}
      {entries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontFamily: "Playfair Display, serif", fontSize: "20px", fontWeight: 700, color: "#1a1a1a" }}>
              Selected Products ({entries.length})
            </h3>
            <button
              onClick={exportPDF}
              style={{ padding: "12px 28px", background: "linear-gradient(135deg, #9A7A30, #C9A84C)", color: "white", border: "none", borderRadius: "10px", fontFamily: "Inter, sans-serif", fontSize: "14px", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 12px rgba(201,168,76,0.3)" }}
            >
              Download PDF Catalog
            </button>
          </div>

          {entries.map((entry, index) => (
            <div key={index} style={{ background: "white", borderRadius: "16px", padding: "24px", boxShadow: "0 4px 24px rgba(0,0,0,0.06)", border: "1px solid #f0e8d5" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
                <div>
                  <h4 style={{ fontFamily: "Playfair Display, serif", fontSize: "18px", fontWeight: 700, color: "#1a1a1a", marginBottom: "4px" }}>
                    Serial: {entry.serialNumber}
                  </h4>
                  <p style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", color: "#9A7A30" }}>
                    {Object.entries(entry.productData).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" • ")}
                  </p>
                </div>
                <button onClick={() => removeEntry(index)} style={{ padding: "6px 14px", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: "6px", fontFamily: "Inter, sans-serif", fontSize: "12px", cursor: "pointer" }}>
                  Remove
                </button>
              </div>

              {/* Media Upload */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                
                {/* Image Upload */}
                <div>
                  <p style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "10px" }}>
                    Product Images
                  </p>
                  <label style={{ display: "block", border: "2px dashed #E8C97A", borderRadius: "10px", padding: "20px", textAlign: "center", cursor: "pointer", background: "#FFFDF7", transition: "all 0.2s" }}>
                    <input type="file" accept="image/*" multiple onChange={(e) => handleImageUpload(index, e.target.files)} style={{ display: "none" }} />
                    <div style={{ fontSize: "28px", marginBottom: "8px" }}>🖼️</div>
                    <p style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", color: "#9CA3AF" }}>Click to upload images</p>
                    <p style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", color: "#C9A84C", marginTop: "4px" }}>SD & HD supported</p>
                  </label>
                  {entry.imagePreviews.length > 0 && (
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
                      {entry.imagePreviews.map((src, i) => (
                        <img key={i} src={src} alt="" style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "8px", border: "2px solid #E8C97A" }} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Video Upload */}
                <div>
                  <p style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "10px" }}>
                    Product Videos
                  </p>
                  <label style={{ display: "block", border: "2px dashed #E8C97A", borderRadius: "10px", padding: "20px", textAlign: "center", cursor: "pointer", background: "#FFFDF7", transition: "all 0.2s" }}>
                    <input type="file" accept="video/*" multiple onChange={(e) => handleVideoUpload(index, e.target.files)} style={{ display: "none" }} />
                    <div style={{ fontSize: "28px", marginBottom: "8px" }}>🎥</div>
                    <p style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", color: "#9CA3AF" }}>Click to upload videos</p>
                    <p style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", color: "#C9A84C", marginTop: "4px" }}>MP4, MOV supported</p>
                  </label>
                  {entry.videoPreviews.length > 0 && (
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
                      {entry.videoPreviews.map((src, i) => (
                        <video key={i} src={src} style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "8px", border: "2px solid #E8C97A" }} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}