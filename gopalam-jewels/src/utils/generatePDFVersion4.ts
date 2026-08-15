import {
  buildCloudinaryDeliveryUrl,
  CLOUDINARY_PDF_TRANSFORMATION,
  getCloudinaryAssetKey,
} from "@/utils/cloudinaryDelivery";
import {
  imageLoadProgress,
  pdfDrawProgress,
  preloadWithConcurrency,
  type PDFProgressCallback,
} from "@/utils/pdfImagePipeline";

type ProductRow = {
  barcode?: string | number;
  imageUrl?: string;
  previewUrl?: string;
  data?: Record<string, unknown> | null;
};

type Version4Settings = {
  rows: number;
  columns: number;
};

type LoadedImage = {
  dataUrl: string;
  width: number;
  height: number;
};

const cleanValue = (value: unknown) => {
  if (value === undefined || value === null || typeof value === "object") return "";
  return String(value).trim();
};

const isProductRow = (row: ProductRow) =>
  Boolean(
    row &&
      (cleanValue(row.barcode) ||
        cleanValue(row.data?.ITEMNO) ||
        cleanValue(row.imageUrl) ||
        cleanValue(row.previewUrl))
  );

const formatDate = (date: Date) =>
  date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const fileDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const safeFilenamePart = (value: string) =>
  value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");

const loadImage = (
  source: string,
  cache: Map<string, Promise<LoadedImage | null>>,
  cacheKey: string
) => {
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const pendingImage = new Promise<LoadedImage | null>(async (resolve) => {
    try {
      const response = await fetch(source);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();

      image.onload = () => {
        const canvas = document.createElement("canvas");
        const maxDimension = 1000;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));

        const context = canvas.getContext("2d");
        context?.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objectUrl);
        resolve({
          dataUrl: canvas.toDataURL("image/jpeg", 0.84),
          width: canvas.width,
          height: canvas.height,
        });
      };

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      };
      image.src = objectUrl;
    } catch (error) {
      console.error(error);
      resolve(null);
    }
  });

  cache.set(cacheKey, pendingImage);
  return pendingImage;
};

const fitTextToWidth = (
  pdf: import("jspdf").jsPDF,
  text: string,
  maxWidth: number
) => {
  if (pdf.getTextWidth(text) <= maxWidth) return text;

  let shortened = text;
  while (shortened && pdf.getTextWidth(`${shortened}…`) > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return shortened ? `${shortened}…` : "";
};

export const generatePDFVersion4 = async (
  rows: ProductRow[],
  companyName: string,
  settings: Version4Settings,
  onProgress?: PDFProgressCallback
) => {
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF("p", "mm", "a4");
  const products = rows.filter(isProductRow);
  const productsPerPage = settings.rows * settings.columns;
  const totalPages = Math.max(1, Math.ceil(products.length / productsPerPage));
  const generatedAt = new Date();
  const displayDate = formatDate(generatedAt);
  const safeCompanyName = cleanValue(companyName) || "Gopalam Gems & Jewellery";
  const imageCache = new Map<string, Promise<LoadedImage | null>>();
  const uniqueImages = new Map<string, string>();

  onProgress?.(5);
  products.forEach((row) => {
    const imageSource = cleanValue(row.imageUrl) || cleanValue(row.previewUrl);
    if (!imageSource) return;
    const optimizedSource = buildCloudinaryDeliveryUrl(
      imageSource,
      CLOUDINARY_PDF_TRANSFORMATION
    );
    uniqueImages.set(getCloudinaryAssetKey(optimizedSource), optimizedSource);
  });

  await preloadWithConcurrency(
    [...uniqueImages.entries()],
    ([cacheKey, source]) => loadImage(source, imageCache, cacheKey),
    (completed, total) => onProgress?.(imageLoadProgress(completed, total))
  );
  if (uniqueImages.size === 0) onProgress?.(80);

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 8;
  const headerY = 7;
  const headerHeight = 12;
  const gridTop = 24;
  const gridBottom = pageHeight - 13;
  const gapX = 2.5;
  const gapY = 2.5;
  const gridWidth = pageWidth - marginX * 2;
  const gridHeight = gridBottom - gridTop;
  const cardWidth =
    (gridWidth - gapX * (settings.columns - 1)) / settings.columns;
  const cardHeight =
    (gridHeight - gapY * (settings.rows - 1)) / settings.rows;
  const padding = Math.min(2, Math.max(0.8, cardWidth * 0.045));
  const labelHeight = Math.min(9, Math.max(5, cardHeight * 0.18));
  const imageBoxWidth = cardWidth - padding * 2;
  const imageBoxHeight = cardHeight - labelHeight - padding * 2;

  const drawHeaderFooter = (pageNumber: number) => {
    pdf.setFillColor(32, 32, 32);
    pdf.rect(marginX, headerY, pageWidth - marginX * 2, headerHeight, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.text(safeCompanyName, pageWidth / 2, headerY + 7.8, { align: "center" });

    pdf.setTextColor(70, 70, 70);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(`Date: ${displayDate}`, marginX, pageHeight - 5);
    pdf.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - marginX, pageHeight - 5, {
      align: "right",
    });
  };

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    if (pageIndex > 0) pdf.addPage();
    drawHeaderFooter(pageIndex + 1);

    const pageProducts = products.slice(
      pageIndex * productsPerPage,
      (pageIndex + 1) * productsPerPage
    );

    for (let index = 0; index < pageProducts.length; index += 1) {
      const product = pageProducts[index];
      const column = index % settings.columns;
      const gridRow = Math.floor(index / settings.columns);
      const x = marginX + column * (cardWidth + gapX);
      const y = gridTop + gridRow * (cardHeight + gapY);
      const labelY = y + cardHeight - labelHeight;

      pdf.setDrawColor(175, 175, 175);
      pdf.setLineWidth(0.2);
      pdf.rect(x, y, cardWidth, cardHeight);
      pdf.setDrawColor(220, 220, 220);
      pdf.line(x, labelY, x + cardWidth, labelY);

      const imageSource =
        cleanValue(product.imageUrl) || cleanValue(product.previewUrl);
      const optimizedSource = buildCloudinaryDeliveryUrl(
        imageSource,
        CLOUDINARY_PDF_TRANSFORMATION
      );
      const cacheKey = getCloudinaryAssetKey(optimizedSource);
      const image = optimizedSource
        ? await loadImage(optimizedSource, imageCache, cacheKey)
        : null;

      if (image && imageBoxWidth > 0 && imageBoxHeight > 0) {
        const scale = Math.min(
          imageBoxWidth / image.width,
          imageBoxHeight / image.height
        );
        const renderWidth = image.width * scale;
        const renderHeight = image.height * scale;
        const imageX = x + padding + (imageBoxWidth - renderWidth) / 2;
        const imageY = y + padding + (imageBoxHeight - renderHeight) / 2;
        pdf.addImage(
          image.dataUrl,
          "JPEG",
          imageX,
          imageY,
          renderWidth,
          renderHeight,
          `version4_${cacheKey}`,
          "FAST"
        );
      }

      const itemNo = cleanValue(product.data?.ITEMNO) || "-";
      const fontSize = Math.min(8, Math.max(5, cardWidth * 0.18));
      pdf.setTextColor(35, 35, 35);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(fontSize);
      const fittedItemNo = fitTextToWidth(pdf, itemNo, cardWidth - padding * 2);
      pdf.text(fittedItemNo, x + cardWidth / 2, labelY + labelHeight / 2 + fontSize * 0.13, {
        align: "center",
      });

      onProgress?.(
        pdfDrawProgress(pageIndex * productsPerPage + index + 1, products.length)
      );
    }
  }

  const filenameCompany = safeFilenamePart(safeCompanyName);
  const filenamePrefix = filenameCompany ? `${filenameCompany}_` : "";
  onProgress?.(100);
  pdf.save(`${filenamePrefix}Gopalam_Catalogue_Version_4_${fileDate(generatedAt)}.pdf`);
};
