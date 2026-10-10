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

type LoadedImage = { dataUrl: string; width: number; height: number };

const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const formatDate = (date: Date) => date.toLocaleDateString("en-GB", {
  day: "2-digit", month: "short", year: "numeric",
});

const fileDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const safeFilenamePart = (value: string) => value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");

const blobToJpeg = (blob: Blob) => new Promise<LoadedImage | null>((resolve) => {
  const image = new Image();
  const objectUrl = URL.createObjectURL(blob);
  image.onload = () => {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 600 / image.width);
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(objectUrl);
    resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.65), width: canvas.width, height: canvas.height });
  };
  image.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
  image.src = objectUrl;
});

const drawImageContain = (pdf: import("jspdf").jsPDF, image: LoadedImage, x: number, y: number, width: number, height: number, alias: string) => {
  const scale = Math.min(width / image.width, height / image.height);
  const renderWidth = image.width * scale;
  const renderHeight = image.height * scale;
  pdf.addImage(image.dataUrl, "JPEG", x + (width - renderWidth) / 2, y + (height - renderHeight) / 2, renderWidth, renderHeight, alias, "FAST");
};

const drawCode128Barcode = (pdf: import("jspdf").jsPDF, value: string, x: number, y: number, width: number, height: number) => {
  const sanitized = value.split("").map((char) => {
    const code = char.charCodeAt(0);
    return code >= 32 && code <= 126 ? char : " ";
  }).join("");
  if (!sanitized) return;
  const codes = [104, ...sanitized.split("").map((char) => char.charCodeAt(0) - 32)];
  const checksum = codes[0] + codes.slice(1).reduce((sum, code, index) => sum + code * (index + 1), 0);
  const patterns = [...codes, checksum % 103, 106].map((code) => CODE128_PATTERNS[code]).filter(Boolean);
  const modules = patterns.reduce((sum, pattern) => sum + pattern.split("").reduce((total, digit) => total + Number(digit), 0), 0);
  const moduleWidth = width / modules;
  let currentX = x;
  pdf.setFillColor(0, 0, 0);
  patterns.forEach((pattern) => pattern.split("").forEach((digit, index) => {
    const segmentWidth = Number(digit) * moduleWidth;
    if (index % 2 === 0) pdf.rect(currentX, y, segmentWidth, height, "F");
    currentX += segmentWidth;
  }));
};

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
  const images = new Map<string, LoadedImage | null>();
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
          if (image) drawImageContain(pdf, image, x + 1, y - 4, widths[index] - 2, rowHeight - 2, `gold_table_${rowIndex}`);
        } else {
          pdf.setFontSize(7);
          pdf.text(pdf.splitTextToSize(valueFor(row, field, options.priceDiscountPercent, options.usdDiscountPercent), widths[index] - 2).slice(0, 3), x + 1, y);
        }
        x += widths[index];
      });
      y += rowHeight;
      onProgress?.(65 + Math.round(((rowIndex + 1) / Math.max(1, rows.length)) * 33));
    });
  } else if (options.version === "version3") {
    const generatedAt = new Date();
    const marginX = 8;
    const headerY = 7;
    const headerHeight = 12;
    const cardTopY = 24;
    const footerHeight = 11;
    const cardGap = 5;
    const cardWidth = (pageWidth - marginX * 2 - cardGap) / 2;
    const cardHeight = (pageHeight - cardTopY - footerHeight - cardGap) / 2;
    const productsPerPage = 4;
    const totalPages = Math.max(1, Math.ceil(rows.length / productsPerPage));
    const detailFields = FIELD_ORDER.filter((field) => !["image", "barcode", "lotNo"].includes(field) && options.selectedFields[field]);

    const drawHeaderFooter = (pageNumber: number) => {
      pdf.setFillColor(32, 32, 32);
      pdf.rect(marginX, headerY, pageWidth - marginX * 2, headerHeight, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.text(title, pageWidth / 2, headerY + 7.8, { align: "center" });
      pdf.setTextColor(70, 70, 70);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.text(`Date: ${formatDate(generatedAt)}`, marginX, pageHeight - 5);
      pdf.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - marginX, pageHeight - 5, { align: "right" });
    };

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
      if (pageIndex > 0) pdf.addPage();
      drawHeaderFooter(pageIndex + 1);
      const pageRows = rows.slice(pageIndex * productsPerPage, pageIndex * productsPerPage + productsPerPage);

      pageRows.forEach((row, indexOnPage) => {
        const productIndex = pageIndex * productsPerPage + indexOnPage;
        const column = indexOnPage % 2;
        const cardRow = Math.floor(indexOnPage / 2);
        const x = marginX + column * (cardWidth + cardGap);
        const y = cardTopY + cardRow * (cardHeight + cardGap);
        const padding = 3;
        const detailHeight = options.selectedFields.image ? 36 : cardHeight - padding * 2;
        const imageHeight = options.selectedFields.image ? cardHeight - detailHeight - padding * 2 : 0;

        pdf.setDrawColor(35, 35, 35);
        pdf.setLineWidth(0.35);
        pdf.rect(x, y, cardWidth, cardHeight);

        if (options.selectedFields.image) {
          const image = images.get(row.id);
          if (image) {
            drawImageContain(pdf, image, x + padding, y + padding, cardWidth - padding * 2, imageHeight, `gold_v3_${productIndex}`);
          } else {
            pdf.setDrawColor(215, 215, 215);
            pdf.rect(x + padding, y + padding, cardWidth - padding * 2, imageHeight);
            pdf.setTextColor(130, 130, 130);
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(8);
            pdf.text("Image unavailable", x + cardWidth / 2, y + padding + imageHeight / 2, { align: "center" });
          }
        }

        const detailsY = options.selectedFields.image ? y + cardHeight - detailHeight : y + padding;
        pdf.setDrawColor(35, 35, 35);
        pdf.line(x, detailsY, x + cardWidth, detailsY);
        pdf.setTextColor(35, 35, 35);
        const leftWidth = options.selectedFields.barcode ? 35 : 27;
        const rightX = x + padding + leftWidth + 4;
        const rightWidth = cardWidth - padding * 2 - leftWidth - 4;
        let leftY = detailsY + 5;

        if (options.selectedFields.lotNo) {
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(7.4);
          const lines = pdf.splitTextToSize(`LOT NO: ${valueFor(row, "lotNo", options.priceDiscountPercent, options.usdDiscountPercent) || "-"}`, leftWidth).slice(0, 2);
          pdf.text(lines, x + padding, leftY);
          leftY += lines.length * 3.5;
        }
        if (options.selectedFields.barcode && row.barcode) {
          const barcode = String(row.barcode);
          const barcodeY = Math.min(detailsY + detailHeight - 18, leftY + 2);
          drawCode128Barcode(pdf, barcode, x + padding, barcodeY, leftWidth, 10);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(6.5);
          pdf.text(barcode, x + padding + leftWidth / 2, barcodeY + 13.2, { align: "center" });
        }

        pdf.setFontSize(7.1);
        let detailY = detailsY + 5;
        detailFields.forEach((field) => {
          if (detailY > detailsY + detailHeight - 4) return;
          const label = `${LABELS[field]}: `;
          const value = valueFor(row, field, options.priceDiscountPercent, options.usdDiscountPercent) || "-";
          pdf.setFont("helvetica", "bold");
          pdf.text(label, rightX, detailY);
          pdf.setFont("helvetica", "normal");
          const valueX = rightX + pdf.getTextWidth(label);
          const lines = pdf.splitTextToSize(value, Math.max(8, rightWidth - pdf.getTextWidth(label))).slice(0, field === "stone" ? 2 : 1);
          pdf.text(lines, valueX, detailY);
          detailY += lines.length * 3.6;
        });
        onProgress?.(65 + Math.round(((productIndex + 1) / Math.max(1, rows.length)) * 33));
      });
    }
  } else {
    const grid = options.version === "version2" ? { rows: 3, columns: 2 } : options.grid;
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
        drawImageContain(pdf, image, x + 3, y + 3, cardWidth - 8, imageHeight, `gold_card_${rowIndex}`);
        textY = y + imageHeight + 7;
      }
      pdf.setFontSize(7);
      fields.forEach((field) => {
        if (textY > y + cardHeight - 5) return;
        pdf.text(`${LABELS[field]}: ${valueFor(row, field, options.priceDiscountPercent, options.usdDiscountPercent)}`, x + 4, textY);
        textY += 4;
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
  const filenameCompany = safeFilenamePart(title);
  pdf.save(options.version === "version3"
    ? `${filenameCompany ? `${filenameCompany}_` : ""}Gold_Catalogue_Version_3_${fileDate(new Date())}.pdf`
    : `gold-products-${options.version}.pdf`);
};
