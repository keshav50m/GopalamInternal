import type { GoldScannerRow } from "@/components/gold/GoldProductLookup";
import {
  fetchImageBlob,
  loadWithImageFallback,
  preloadWithConcurrency,
} from "@/utils/pdfImagePipeline";

const blobToDataUrl = (blob: Blob) => new Promise<string | null>((resolve) => {
  const image = new Image();
  const objectUrl = URL.createObjectURL(blob);
  image.onload = () => {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 600 / image.width);
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(objectUrl);
    resolve(canvas.toDataURL("image/jpeg", 0.65));
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(null);
  };
  image.src = objectUrl;
});

export const generateGoldPDF = async (
  rows: GoldScannerRow[],
  companyName: string,
  priceDiscountPercent: number,
  usdDiscountPercent: number,
  onProgress?: (progress: number) => void
) => {
  const [{ default: jsPDF }, { applyDiscount }] = await Promise.all([
    import("jspdf"),
    import("@/utils/applyDiscount"),
  ]);
  const pdf = new jsPDF("l", "mm", "a4");
  const images = new Map<string, string | null>();
  const imageRows = rows.filter((row) => row.imageUrl || row.previewUrl);
  onProgress?.(5);

  await preloadWithConcurrency(imageRows, async (row) => {
    const primary = row.imageUrl || row.previewUrl;
    const loaded = await loadWithImageFallback(primary, row.fallbackImageUrl, async (url) => {
      const blob = await fetchImageBlob(url);
      return blob ? blobToDataUrl(blob) : null;
    });
    images.set(row.id, loaded);
  }, (complete, total) => onProgress?.(10 + Math.round((complete / total) * 55)));

  const columns = ["Image", "Barcode", "Lot No", "Karat", "Stone", "NW", "GW", "ST WT.", "DI WT.", "Total Tag", "US$"]; 
  const widths = [24, 22, 34, 18, 31, 18, 18, 19, 19, 24, 22];
  const startX = 7;
  const rowHeight = 20;
  let y = 22;

  const drawHeader = () => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text(companyName || "Gold Jewellery", pdf.internal.pageSize.getWidth() / 2, 10, { align: "center" });
    pdf.setFontSize(7);
    let x = startX;
    columns.forEach((label, index) => {
      pdf.rect(x, y - 5, widths[index], 8);
      pdf.text(label, x + 1, y);
      x += widths[index];
    });
    y += 8;
    pdf.setFont("helvetica", "normal");
  };

  drawHeader();
  rows.forEach((row, rowIndex) => {
    if (!row.data) return;
    if (y + rowHeight > 200) {
      pdf.addPage();
      y = 22;
      drawHeader();
    }
    const values = [
      "", row.barcode, row.data["LOT NO"], row.data.KARAT1,
      row.data["STONE NAME"], row.data.NW, row.data.GW,
      row.data["ST WT."], row.data["DI WT."],
      String(Math.round(Number(applyDiscount(row.data["TOTAL TAG"], priceDiscountPercent)) || 0)),
      Number(applyDiscount(row.data["US$"], usdDiscountPercent) || 0).toFixed(2),
    ];
    let x = startX;
    values.forEach((value, index) => {
      pdf.rect(x, y - 5, widths[index], rowHeight);
      if (index === 0) {
        const image = images.get(row.id);
        if (image) pdf.addImage(image, "JPEG", x + 1, y - 4, widths[index] - 2, rowHeight - 2);
      } else {
        const lines = pdf.splitTextToSize(String(value || ""), widths[index] - 2).slice(0, 3);
        pdf.text(lines, x + 1, y);
      }
      x += widths[index];
    });
    y += rowHeight;
    onProgress?.(65 + Math.round(((rowIndex + 1) / Math.max(1, rows.length)) * 33));
  });

  onProgress?.(100);
  pdf.save("gold-products.pdf");
};
