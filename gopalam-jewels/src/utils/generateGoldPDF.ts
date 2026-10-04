import type { GoldScannerRow } from "@/components/gold/GoldProductLookup";
import { applyDiscount } from "@/utils/applyDiscount";
import { fetchImageBlob, loadWithImageFallback, preloadWithConcurrency } from "@/utils/pdfImagePipeline";

export type GoldPDFVersion = "version1" | "version2" | "version3" | "version4" | "version5";
export type GoldPDFField = "image" | "barcode" | "lotNo" | "karat" | "stone" | "nw" | "gw" | "stoneWt" | "diamondWt" | "totalTag" | "usd";
export type GoldPDFOptions = {
  version: GoldPDFVersion;
  selectedFields: Record<GoldPDFField, boolean>;
  companyName: string;
  priceDiscountPercent: number;
  usdDiscountPercent: number;
  uniqueLotNo: boolean;
  grid: { rows: number; columns: number };
};

const FIELD_ORDER: GoldPDFField[] = ["image", "barcode", "lotNo", "karat", "stone", "nw", "gw", "stoneWt", "diamondWt", "totalTag", "usd"];
const LABELS: Record<GoldPDFField, string> = {
  image: "Image", barcode: "Barcode", lotNo: "Lot No", karat: "Karat", stone: "Stone",
  nw: "NW", gw: "GW", stoneWt: "ST WT.", diamondWt: "DI WT.", totalTag: "Total Tag", usd: "US$",
};

const blobToJpeg = (blob: Blob) => new Promise<string | null>((resolve) => {
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
  image.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
  image.src = objectUrl;
});

const valueFor = (row: GoldScannerRow, field: GoldPDFField, priceDiscount: number, usdDiscount: number) => {
  const data = row.data;
  if (!data) return "";
  if (field === "barcode") return row.barcode;
  if (field === "lotNo") return data["LOT NO"];
  if (field === "karat") return data.KARAT1;
  if (field === "stone") return data["STONE NAME"];
  if (field === "nw") return data.NW;
  if (field === "gw") return data.GW;
  if (field === "stoneWt") return data["ST WT."];
  if (field === "diamondWt") return data["DI WT."];
  if (field === "totalTag") {
    const value = applyDiscount(data["TOTAL TAG"], priceDiscount);
    return value === "" ? "" : String(Math.round(Number(value)));
  }
  if (field === "usd") {
    const value = applyDiscount(data["US$"], usdDiscount);
    return value === "" ? "" : Number(value).toFixed(2);
  }
  return "";
};

const uniqueByLotNo = (rows: GoldScannerRow[]) => {
  const unique = new Map<string, GoldScannerRow>();
  rows.forEach((row) => {
    const lotNo = String(row.data?.["LOT NO"] || row.barcode).trim().toUpperCase();
    if (!unique.has(lotNo)) unique.set(lotNo, row);
  });
  return [...unique.values()];
};

export const generateGoldPDF = async (sourceRows: GoldScannerRow[], options: GoldPDFOptions, onProgress?: (progress: number) => void) => {
  const { default: jsPDF } = await import("jspdf");
  const groupedCounts = new Map<string, number>();
  sourceRows.forEach((row) => {
    const lotNo = String(row.data?.["LOT NO"] || row.barcode).trim().toUpperCase();
    groupedCounts.set(lotNo, (groupedCounts.get(lotNo) || 0) + 1);
  });
  const rows = options.uniqueLotNo || options.version === "version5" ? uniqueByLotNo(sourceRows) : sourceRows;
  const images = new Map<string, string | null>();
  const imageRows = options.selectedFields.image ? rows.filter((row) => row.imageUrl || row.previewUrl) : [];
  onProgress?.(5);
  await preloadWithConcurrency(imageRows, async (row) => {
    const loaded = await loadWithImageFallback(row.imageUrl || row.previewUrl, row.fallbackImageUrl, async (url) => {
      const blob = await fetchImageBlob(url);
      return blob ? blobToJpeg(blob) : null;
    });
    images.set(row.id, loaded);
  }, (complete, total) => onProgress?.(10 + Math.round((complete / total) * 55)));

  const pdf = new jsPDF(options.version === "version1" ? "l" : "p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const title = options.companyName || "Gold Jewellery";
  const drawTitle = () => {
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(14);
    pdf.text(title, pageWidth / 2, 11, { align: "center" });
    pdf.setFont("helvetica", "normal");
  };
  drawTitle();

  if (options.version === "version1") {
    const fields = FIELD_ORDER.filter((field) => options.selectedFields[field]);
    const startX = 7;
    const availableWidth = pageWidth - 14;
    const totalWeight = fields.reduce((sum, field) => sum + (field === "image" ? 1.8 : 1), 0);
    const widths = fields.map((field) => availableWidth * (field === "image" ? 1.8 : 1) / totalWeight);
    let y = 22;
    const drawHeader = () => {
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(7);
      let x = startX;
      fields.forEach((field, index) => { pdf.rect(x, y - 5, widths[index], 8); pdf.text(LABELS[field], x + 1, y); x += widths[index]; });
      y += 8; pdf.setFont("helvetica", "normal");
    };
    drawHeader();
    rows.forEach((row, rowIndex) => {
      const rowHeight = 20;
      if (y + rowHeight > pageHeight - 8) { pdf.addPage(); y = 22; drawTitle(); drawHeader(); }
      let x = startX;
      fields.forEach((field, index) => {
        pdf.rect(x, y - 5, widths[index], rowHeight);
        if (field === "image") {
          const image = images.get(row.id);
          if (image) pdf.addImage(image, "JPEG", x + 1, y - 4, widths[index] - 2, rowHeight - 2);
        } else {
          pdf.setFontSize(7);
          pdf.text(pdf.splitTextToSize(valueFor(row, field, options.priceDiscountPercent, options.usdDiscountPercent), widths[index] - 2).slice(0, 3), x + 1, y);
        }
        x += widths[index];
      });
      y += rowHeight;
      onProgress?.(65 + Math.round(((rowIndex + 1) / Math.max(1, rows.length)) * 33));
    });
  } else {
    const grid = options.version === "version2" ? { rows: 3, columns: 2 } : options.version === "version3" ? { rows: 2, columns: 1 } : options.grid;
    const margin = 8;
    const top = 18;
    const cardWidth = (pageWidth - margin * 2) / grid.columns;
    const cardHeight = (pageHeight - top - margin) / grid.rows;
    const fields = FIELD_ORDER.filter((field) => field !== "image" && options.selectedFields[field]);
    rows.forEach((row, rowIndex) => {
      const pageCapacity = grid.rows * grid.columns;
      if (rowIndex > 0 && rowIndex % pageCapacity === 0) { pdf.addPage(); drawTitle(); }
      const position = rowIndex % pageCapacity;
      const x = margin + (position % grid.columns) * cardWidth;
      const y = top + Math.floor(position / grid.columns) * cardHeight;
      pdf.rect(x, y, cardWidth - 2, cardHeight - 2);
      let textY = y + 5;
      const image = images.get(row.id);
      if (options.selectedFields.image && image) {
        const imageHeight = Math.min(cardHeight * 0.55, 65);
        pdf.addImage(image, "JPEG", x + 3, y + 3, cardWidth - 8, imageHeight);
        textY = y + imageHeight + 7;
      }
      pdf.setFontSize(options.version === "version3" ? 10 : 7);
      fields.forEach((field) => {
        if (textY > y + cardHeight - 5) return;
        pdf.text(`${LABELS[field]}: ${valueFor(row, field, options.priceDiscountPercent, options.usdDiscountPercent)}`, x + 4, textY);
        textY += options.version === "version3" ? 6 : 4;
      });
      if (options.version === "version5") {
        const key = String(row.data?.["LOT NO"] || row.barcode).trim().toUpperCase();
        pdf.setFont("helvetica", "bold");
        pdf.text(`Quantity: ${groupedCounts.get(key) || 1}`, x + 4, Math.min(textY + 2, y + cardHeight - 4));
        pdf.setFont("helvetica", "normal");
      }
      onProgress?.(65 + Math.round(((rowIndex + 1) / Math.max(1, rows.length)) * 33));
    });
  }
  onProgress?.(100);
  pdf.save(`gold-products-${options.version}.pdf`);
};
