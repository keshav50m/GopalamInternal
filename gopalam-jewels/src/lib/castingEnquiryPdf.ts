import type { CastingCatalogueEnquiryDocument } from "./castingCatalogueEnquiries";
import { CASTING_CATALOGUE_FIELDS, CASTING_CATALOGUE_FIELD_LABELS } from "./castingCatalogue";
import { resolveImageCandidates } from "../utils/imageProvider";

type LoadedImage = { bytes: Uint8Array; format: "JPEG" | "PNG" } | null;

const loadImage = async (image: string, r2Image: string): Promise<LoadedImage> => {
  const { primaryUrl, fallbackUrl } = resolveImageCandidates({ image, r2Image, provider: process.env.IMAGE_FETCH_PROVIDER });
  for (const url of [primaryUrl, fallbackUrl].filter(Boolean)) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      const type = response.headers.get("content-type")?.toLowerCase() || "";
      if (!response.ok || (!type.includes("jpeg") && !type.includes("jpg") && !type.includes("png"))) continue;
      return { bytes: new Uint8Array(await response.arrayBuffer()), format: type.includes("png") ? "PNG" : "JPEG" };
    } catch { /* try fallback */ }
  }
  return null;
};

export const generateCastingEnquiryPdf = async (enquiry: CastingCatalogueEnquiryDocument) => {
  const jsPdfModule = await import("jspdf");
  const jsPDF = jsPdfModule.jsPDF || jsPdfModule.default;
  const pdf = new jsPDF("p", "mm", "a4");
  const cache = new Map<string, Promise<LoadedImage>>();
  const loaded: LoadedImage[] = new Array(enquiry.products.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, enquiry.products.length) }, async () => {
    while (next < enquiry.products.length) {
      const index = next++;
      const product = enquiry.products[index];
      const key = `${product.r2Image}|${product.image}`;
      if (!cache.has(key)) cache.set(key, loadImage(product.image, product.r2Image));
      loaded[index] = await cache.get(key)!;
    }
  }));

  const fields = CASTING_CATALOGUE_FIELDS.filter((field) => field !== "image" && enquiry.visibleFields[field]);
  const pageWidth = 210;
  const margin = 14;
  const cardHeight = 76;
  const drawHeader = () => {
    pdf.setTextColor(138, 106, 36); pdf.setFont("helvetica", "bold"); pdf.setFontSize(18);
    pdf.text(enquiry.catalogueTitle || "Casting Jewellery Selection", margin, 16);
    pdf.setTextColor(55, 48, 38); pdf.setFontSize(9); pdf.setFont("helvetica", "normal");
    pdf.text(`Customer: ${enquiry.customer.name}`, margin, 23);
    pdf.text(`Enquiry: ${enquiry.enquiryId}`, margin, 28);
    pdf.text(`Submitted: ${new Date(enquiry.submittedAt).toLocaleString("en-IN")}`, pageWidth - margin, 23, { align: "right" });
    pdf.text(`Total quantity: ${enquiry.totalQuantity}`, pageWidth - margin, 28, { align: "right" });
    pdf.setDrawColor(216, 200, 159); pdf.line(margin, 32, pageWidth - margin, 32);
  };
  drawHeader();
  let y = 37;
  enquiry.products.forEach((product, index) => {
    if (y + cardHeight > 282) { pdf.addPage(); drawHeader(); y = 37; }
    pdf.setDrawColor(230, 220, 199); pdf.roundedRect(margin, y, pageWidth - margin * 2, cardHeight - 4, 2, 2);
    const imageBox = enquiry.visibleFields.image ? 58 : 0;
    if (imageBox) {
      pdf.setFillColor(250, 248, 243); pdf.rect(margin + 3, y + 3, 52, 64, "F");
      const image = loaded[index];
      if (image) {
        try { pdf.addImage(image.bytes, image.format, margin + 5, y + 5, 48, 60, `img-${index}`, "FAST", 0); } catch { /* leave placeholder */ }
      }
    }
    const x = margin + imageBox + 5;
    const width = pageWidth - margin - x - 5;
    pdf.setTextColor(45, 39, 30); pdf.setFont("helvetica", "bold"); pdf.setFontSize(11);
    pdf.text(`Product ${index + 1}   Quantity: ${product.quantity}`, x, y + 8);
    pdf.setFontSize(8.5); let textY = y + 15;
    fields.forEach((field) => {
      const value = product.visibleDetails[field] || "-";
      pdf.setFont("helvetica", "bold"); pdf.text(`${CASTING_CATALOGUE_FIELD_LABELS[field]}:`, x, textY);
      pdf.setFont("helvetica", "normal");
      const labelWidth = pdf.getTextWidth(`${CASTING_CATALOGUE_FIELD_LABELS[field]}: `);
      const lines = pdf.splitTextToSize(value, Math.max(20, width - labelWidth)).slice(0, 2);
      pdf.text(lines, x + labelWidth + 1, textY); textY += Math.max(6, lines.length * 4);
    });
    y += cardHeight;
  });
  if (enquiry.visibleFields.price || enquiry.visibleFields.usd) {
    if (y + 20 > 282) { pdf.addPage(); drawHeader(); y = 40; }
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(10);
    if (enquiry.visibleFields.price) { pdf.text(`Total Tag Price: ${enquiry.totals.tagPrice ?? 0}`, margin, y); y += 6; }
    if (enquiry.visibleFields.usd) pdf.text(`Total USD: ${enquiry.totals.usd ?? 0}`, margin, y);
  }
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) { pdf.setPage(page); pdf.setFontSize(8); pdf.setTextColor(120); pdf.text(`Page ${page} of ${pages}`, pageWidth - margin, 291, { align: "right" }); }
  return new Uint8Array(pdf.output("arraybuffer"));
};
