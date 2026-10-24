import type { jsPDF as PdfDocument } from "jspdf";
import type { CastingCatalogueEnquiryDocument, CastingCatalogueEnquiryProduct } from "./castingCatalogueEnquiries";
import { CASTING_CATALOGUE_FIELDS, CASTING_CATALOGUE_FIELD_LABELS } from "./castingCatalogue";
import { resolveImageCandidates } from "../utils/imageProvider";

type LoadedImage = { bytes: Uint8Array; format: "JPEG" | "PNG"; alias: string } | null;
type DetailRow = { label: string; lines: string[]; height: number };
type ProductCard = {
  product: CastingCatalogueEnquiryProduct;
  index: number;
  title: string[];
  barcode: string[];
  rows: DetailRow[];
  customization: string[];
  headerHeight: number;
  height: number;
};

const theme = {
  ink: [45, 38, 28], gold: [143, 109, 43], cream: [249, 246, 238],
  line: [227, 216, 192], muted: [119, 108, 88], white: [255, 255, 255],
} as const;
const PAGE_WIDTH = 210;
const MARGIN = 12;
const GAP = 6;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CARD_WIDTH = (CONTENT_WIDTH - GAP) / 2;
const PAGE_BOTTOM = 280;
const IMAGE_HEIGHT = 33;
const formatNumber = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const cleanText = (value: unknown) => String(value ?? "").replace(/[\u2010-\u2015]/g, "-");

const loadImage = async (image: string, r2Image: string, alias: string): Promise<LoadedImage> => {
  const { primaryUrl, fallbackUrl } = resolveImageCandidates({ image, r2Image, provider: process.env.IMAGE_FETCH_PROVIDER });
  for (const url of [...new Set([primaryUrl, fallbackUrl].filter(Boolean))]) {
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const type = response.headers.get("content-type")?.toLowerCase() || "";
      if (!response.ok || (!type.includes("jpeg") && !type.includes("jpg") && !type.includes("png"))) continue;
      return { bytes: new Uint8Array(await response.arrayBuffer()), format: type.includes("png") ? "PNG" : "JPEG", alias };
    } catch { /* Keep the PDF usable when an image cannot be fetched. */ }
  }
  return null;
};

const drawContainedImage = (pdf: PdfDocument, image: LoadedImage, x: number, y: number, width: number, height: number) => {
  pdf.setFillColor(...theme.cream);
  pdf.roundedRect(x, y, width, height, 1.5, 1.5, "F");
  if (image) {
    try {
      const properties = pdf.getImageProperties(image.bytes);
      const scale = Math.min((width - 2) / properties.width, (height - 2) / properties.height);
      const drawWidth = properties.width * scale;
      const drawHeight = properties.height * scale;
      pdf.addImage(image.bytes, image.format, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight, image.alias, "FAST");
      return;
    } catch { /* Use the same placeholder for an unreadable image. */ }
  }
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(...theme.muted);
  pdf.text("Image unavailable", x + width / 2, y + height / 2, { align: "center" });
};

export const generateCastingEnquiryPdf = async (enquiry: CastingCatalogueEnquiryDocument) => {
  const jsPdfModule = await import("jspdf");
  const jsPDF = jsPdfModule.jsPDF || jsPdfModule.default;
  const pdf = new jsPDF("p", "mm", "a4");
  pdf.setProperties({ title: `${enquiry.catalogueTitle || "Jewellery selection"} - ${enquiry.enquiryId}`, author: "Gopalam Jewels" });
  const fields = CASTING_CATALOGUE_FIELDS.filter((field) => !["image", "item", "barcode"].includes(field) && enquiry.visibleFields[field]);
  const cache = new Map<string, Promise<LoadedImage>>();
  const loaded: LoadedImage[] = new Array(enquiry.products.length).fill(null);
  let next = 0;
  if (enquiry.visibleFields.image) {
    await Promise.all(Array.from({ length: Math.min(4, enquiry.products.length) }, async () => {
      while (next < enquiry.products.length) {
        const index = next++;
        const product = enquiry.products[index];
        const key = `${product.r2Image}|${product.image}`;
        if (!cache.has(key)) cache.set(key, loadImage(product.image, product.r2Image, `selection-image-${cache.size}`));
        loaded[index] = await cache.get(key)!;
      }
    }));
  }

  const measureCard = (product: CastingCatalogueEnquiryProduct, index: number): ProductCard => {
    const innerWidth = CARD_WIDTH - 8;
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(10);
    const title = pdf.splitTextToSize(cleanText(enquiry.visibleFields.item && product.visibleDetails.item ? product.visibleDetails.item : `Design ${String(index + 1).padStart(2, "0")}`), innerWidth) as string[];
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.2);
    const barcode = enquiry.visibleFields.barcode
      ? pdf.splitTextToSize(`Barcode: ${cleanText(product.visibleDetails.barcode || "-")}`, innerWidth) as string[]
      : [];
    const headerHeight = 14 + title.length * 4 + barcode.length * 3.5;
    pdf.setFontSize(7.8);
    const rows = fields.map((field) => {
      const label = CASTING_CATALOGUE_FIELD_LABELS[field];
      pdf.setFont("helvetica", "bold");
      const lines = pdf.splitTextToSize(cleanText(product.visibleDetails[field] || "-"), innerWidth - 29) as string[];
      return { label, lines, height: Math.max(4.2, lines.length * 3.3 + .9) };
    });
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.7);
    const customization = [
      product.customization?.ringSize ? `Ring size: ${cleanText(product.customization.ringSize)}` : "",
      product.customization?.stoneColor ? `Stone color: ${cleanText(product.customization.stoneColor)}` : "",
      product.customization?.additionalChanges ? `Additional changes: ${cleanText(product.customization.additionalChanges)}` : "",
    ].filter(Boolean).flatMap((line) => pdf.splitTextToSize(line, innerWidth - 6) as string[]);
    const customizationHeight = customization.length ? 10 + customization.length * 3.5 : 0;
    const height = headerHeight + (enquiry.visibleFields.image ? IMAGE_HEIGHT + 3 : 0) + rows.reduce((sum, row) => sum + row.height, 0) + customizationHeight + 8;
    return { product, index, title, barcode, rows, customization, headerHeight, height: Math.max(50, height) };
  };

  const catalogueTitle = cleanText(enquiry.catalogueTitle || "Casting Jewellery Selection");
  const drawHeader = () => {
    pdf.setFont("times", "bold"); pdf.setFontSize(21); pdf.setTextColor(...theme.ink);
    pdf.text("Gopalam Jewels", MARGIN, 18);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(7); pdf.setTextColor(...theme.gold);
    pdf.text("YOUR JEWELLERY SELECTION", PAGE_WIDTH - MARGIN, 17, { align: "right" });
    pdf.setDrawColor(...theme.gold); pdf.setLineWidth(.45); pdf.line(MARGIN, 23, PAGE_WIDTH - MARGIN, 23);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(...theme.ink);
    const titleLines = pdf.splitTextToSize(catalogueTitle, CONTENT_WIDTH) as string[];
    pdf.text(titleLines, MARGIN, 30);
    const infoY = 35 + (titleLines.length - 1) * 4.5;
    pdf.setFontSize(7); pdf.setTextColor(...theme.muted);
    pdf.text("PREPARED FOR", MARGIN, infoY); pdf.text("ENQUIRY REFERENCE", 118, infoY);
    pdf.setFontSize(9); pdf.setTextColor(...theme.ink);
    const nameLines = pdf.splitTextToSize(cleanText(enquiry.customer.name), 96) as string[];
    pdf.text(nameLines, MARGIN, infoY + 5);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
    pdf.text(enquiry.enquiryId, 118, infoY + 5);
    const date = new Date(enquiry.submittedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
    pdf.text(date, 118, infoY + 10);
    const customerBottom = infoY + 5 + (nameLines.length - 1) * 4;
    if (enquiry.customer.mobile) pdf.text(cleanText(enquiry.customer.mobile), MARGIN, customerBottom + 4.5);
    const statsY = Math.max(infoY + 17, customerBottom + (enquiry.customer.mobile ? 11 : 7));
    pdf.setFontSize(8); pdf.setTextColor(...theme.gold);
    pdf.text(`${enquiry.products.length} selected designs   |   ${enquiry.totalQuantity} total pieces`, MARGIN, statsY);
    pdf.setDrawColor(...theme.line); pdf.setLineWidth(.2); pdf.line(MARGIN, statsY + 3, PAGE_WIDTH - MARGIN, statsY + 3);
    return statsY + 8;
  };

  const drawCard = (card: ProductCard, x: number, y: number, height: number) => {
    pdf.setFillColor(...theme.white); pdf.setDrawColor(...theme.line); pdf.setLineWidth(.25);
    pdf.roundedRect(x, y, CARD_WIDTH, height, 2, 2, "FD");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(7); pdf.setTextColor(...theme.gold);
    pdf.text(`DESIGN ${String(card.index + 1).padStart(2, "0")}`, x + 4, y + 7);
    pdf.setFillColor(...theme.gold); pdf.roundedRect(x + CARD_WIDTH - 34, y + 3, 30, 6, 3, 3, "F");
    pdf.setFontSize(8); pdf.setTextColor(...theme.white);
    pdf.text(`Quantity: ${card.product.quantity}`, x + CARD_WIDTH - 19, y + 7.1, { align: "center" });
    pdf.setFontSize(10); pdf.setTextColor(...theme.ink);
    pdf.text(card.title, x + 4, y + 15);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.2); pdf.setTextColor(...theme.muted);
    if (card.barcode.length) pdf.text(card.barcode, x + 4, y + 15 + card.title.length * 4);
    let contentY = y + card.headerHeight;
    if (enquiry.visibleFields.image) {
      drawContainedImage(pdf, loaded[card.index], x + 4, contentY, CARD_WIDTH - 8, IMAGE_HEIGHT);
      contentY += IMAGE_HEIGHT + 3;
    }
    for (const row of card.rows) {
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.8); pdf.setTextColor(...theme.muted);
      pdf.text(row.label, x + 4, contentY + 3);
      pdf.setFont("helvetica", "bold"); pdf.setTextColor(...theme.ink);
      pdf.text(row.lines, x + CARD_WIDTH - 4, contentY + 3, { align: "right" });
      contentY += row.height;
      pdf.setDrawColor(...theme.line); pdf.setLineWidth(.1); pdf.line(x + 4, contentY, x + CARD_WIDTH - 4, contentY);
    }
    if (card.customization.length) {
      const blockY = contentY + 3;
      pdf.setFillColor(...theme.cream);
      pdf.roundedRect(x + 4, blockY, CARD_WIDTH - 8, 8 + card.customization.length * 3.5, 1.5, 1.5, "F");
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(7); pdf.setTextColor(...theme.gold);
      pdf.text("YOUR CUSTOMIZATION", x + 7, blockY + 4.5);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.7); pdf.setTextColor(...theme.ink);
      card.customization.forEach((line, index) => pdf.text(line, x + 7, blockY + 9 + index * 3.5));
    }
  };

  const totalLines = [
    enquiry.visibleFields.price ? `Total Tag Price: ${formatNumber(enquiry.totals.tagPrice ?? 0)}` : "",
    enquiry.visibleFields.usd ? `Total USD: ${formatNumber(enquiry.totals.usd ?? 0)}` : "",
  ].filter(Boolean);
  const measureSummary = (width: number) => {
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
    const remarks = enquiry.customer.remarks ? pdf.splitTextToSize(cleanText(enquiry.customer.remarks), width - 14) as string[] : [];
    return { remarks, height: 25 + totalLines.length * 6 + (remarks.length ? 10 + remarks.length * 4 : 0) };
  };
  const drawSummary = (x: number, y: number, width: number, minimumHeight = 0) => {
    const summary = measureSummary(width);
    pdf.setFillColor(...theme.cream); pdf.setDrawColor(...theme.line);
    pdf.roundedRect(x, y, width, Math.max(minimumHeight, summary.height), 2, 2, "FD");
    pdf.setFont("times", "bold"); pdf.setFontSize(width < CONTENT_WIDTH ? 13 : 15); pdf.setTextColor(...theme.ink);
    pdf.text("Your selection at a glance", x + 6, y + 9);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(...theme.muted);
    pdf.text(`${enquiry.products.length} designs selected   |   Total quantity: ${enquiry.totalQuantity}`, x + 6, y + 16);
    let summaryY = y + 23;
    pdf.setFont("helvetica", "bold"); pdf.setTextColor(...theme.ink);
    for (const line of totalLines) { pdf.text(line, x + 6, summaryY); summaryY += 6; }
    if (summary.remarks.length) {
      pdf.setFontSize(8); pdf.setTextColor(...theme.gold); pdf.text("YOUR REMARKS", x + 6, summaryY + 2);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(...theme.ink);
      summary.remarks.forEach((line, index) => pdf.text(line, x + 6, summaryY + 8 + index * 4));
    }
  };

  let y = drawHeader();
  let summaryPlaced = false;
  for (let index = 0; index < enquiry.products.length; index += 2) {
    const cards = enquiry.products.slice(index, index + 2).map((product, offset) => measureCard(product, index + offset));
    const rowHeight = Math.max(...cards.map((card) => card.height), cards.length === 1 ? measureSummary(CARD_WIDTH).height : 0);
    if (y + rowHeight > PAGE_BOTTOM) { pdf.addPage(); y = drawHeader(); }
    cards.forEach((card, column) => drawCard(card, MARGIN + column * (CARD_WIDTH + GAP), y, rowHeight));
    if (cards.length === 1) { drawSummary(MARGIN + CARD_WIDTH + GAP, y, CARD_WIDTH, rowHeight); summaryPlaced = true; }
    y += rowHeight + GAP;
  }
  if (!summaryPlaced) {
    if (y + measureSummary(CONTENT_WIDTH).height > PAGE_BOTTOM) { pdf.addPage(); y = drawHeader(); }
    drawSummary(MARGIN, y, CONTENT_WIDTH);
  }

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setDrawColor(...theme.line); pdf.setLineWidth(.2); pdf.line(MARGIN, 285, PAGE_WIDTH - MARGIN, 285);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5); pdf.setTextColor(...theme.muted);
    pdf.text("Gopalam Jewels  |  Customer selection", MARGIN, 291);
    pdf.text(`Page ${page} of ${pages}`, PAGE_WIDTH - MARGIN, 291, { align: "right" });
  }
  return new Uint8Array(pdf.output("arraybuffer"));
};
