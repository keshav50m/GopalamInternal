import {
  buildCloudinaryDeliveryUrl,
  CLOUDINARY_PDF_TRANSFORMATION,
  getCloudinaryAssetKey,
} from "@/utils/cloudinaryDelivery";
import {
  getOrCreateBoundedCacheEntry,
  imageLoadProgress,
  pdfDrawProgress,
  preloadWithConcurrency,
  type PDFProgressCallback,
} from "@/utils/pdfImagePipeline";

type SelectedFields = Record<string, boolean>;

type ProductRow = {
  barcode?: string | number;
  imageUrl?: string;
  previewUrl?: string;
  data?: Record<string, unknown> | null;
};

type LoadedImage = {
  dataUrl: string;
  width: number;
  height: number;
};

const version3ImageCache = new Map<
  string,
  Promise<LoadedImage | null>
>();

const code128Patterns = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131", "211412", "211214",
  "211232", "2331112",
];

const fieldLabels: Record<string, string> = {
  stone: "Stone",
  gross: "Gross",
  stoneWt: "Stone Wt",
  dai: "DAI",
  price: "Price",
  usd: "USD",
  size: "Size",
};

const rightDetailFields = ["stone", "gross", "stoneWt", "dai", "price", "usd", "size"];

const cleanValue = (value: unknown) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return "";
  const normalized = String(value).trim();
  return normalized || "";
};

const displayValue = (value: unknown) => cleanValue(value) || "-";

const formatNumber = (value: unknown, digits: number) => {
  const normalized = cleanValue(value);
  if (!normalized) return "";

  const numericValue = Number.parseFloat(normalized);
  if (Number.isNaN(numericValue)) return normalized;

  return numericValue.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const getFieldValue = (row: ProductRow, field: string) => {
  const data = row.data || {};

  if (field === "stone") return cleanValue(data["STONE NAME"]);
  if (field === "gross") return formatNumber(data["GROSS WT"], 3);
  if (field === "stoneWt") return formatNumber(data["STONE WT"], 2);
  if (field === "dai") return formatNumber(data["DAI WT"], 2);
  if (field === "price") return cleanValue(data["TAG PRICE"]);
  if (field === "usd") return cleanValue(data.USD);
  if (field === "size") return cleanValue(data.SIZE);

  return "";
};

const isProductRow = (row: ProductRow) => {
  if (!row) return false;

  const data = row.data || {};
  return Boolean(
    cleanValue(row.barcode) ||
      cleanValue(data.ITEMNO) ||
      cleanValue(data["STONE NAME"]) ||
      cleanValue(row.imageUrl) ||
      cleanValue(row.previewUrl)
  );
};

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

const loadImage = async (
  src: string,
  cache: Map<string, Promise<LoadedImage | null>>,
  cacheKey = src
) => {
  return getOrCreateBoundedCacheEntry(
    cache,
    cacheKey,
    () =>
      new Promise<LoadedImage | null>(async (resolve) => {
        try {
          const response = await fetch(src);
          if (!response.ok) {
            resolve(null);
            return;
          }
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          const image = new Image();

          image.onload = () => {
            const canvas = document.createElement("canvas");
            const maxDimension = 1200;
            const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));

            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));

            const context = canvas.getContext("2d");
            context?.drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(objectUrl);

            resolve({
              dataUrl: canvas.toDataURL("image/jpeg", 0.86),
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
      })
  );
};

const getCode128Codes = (value: string) => {
  const sanitized = value
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code <= 126 ? char : " ";
    })
    .join("");

  if (!sanitized) return [];

  const codes = [104, ...sanitized.split("").map((char) => char.charCodeAt(0) - 32)];
  const checksum =
    codes[0] +
    codes.slice(1).reduce((sum, code, index) => sum + code * (index + 1), 0);

  return [...codes, checksum % 103, 106];
};

const drawCode128Barcode = (
  pdf: import("jspdf").jsPDF,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number
) => {
  const codes = getCode128Codes(value);
  if (codes.length === 0) return;

  const patterns = codes.map((code) => code128Patterns[code]).filter(Boolean);
  const totalModules = patterns.reduce(
    (sum, pattern) =>
      sum + pattern.split("").reduce((patternSum, digit) => patternSum + Number(digit), 0),
    0
  );
  const moduleWidth = width / totalModules;
  let currentX = x;

  pdf.setFillColor(0, 0, 0);

  patterns.forEach((pattern) => {
    pattern.split("").forEach((digit, index) => {
      const segmentWidth = Number(digit) * moduleWidth;
      if (index % 2 === 0) {
        pdf.rect(currentX, y, segmentWidth, height, "F");
      }
      currentX += segmentWidth;
    });
  });
};

const drawImageContain = (
  pdf: import("jspdf").jsPDF,
  image: LoadedImage,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number,
  alias: string
) => {
  const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
  const renderWidth = image.width * scale;
  const renderHeight = image.height * scale;
  const renderX = boxX + (boxWidth - renderWidth) / 2;
  const renderY = boxY + (boxHeight - renderHeight) / 2;

  pdf.addImage(image.dataUrl, "JPEG", renderX, renderY, renderWidth, renderHeight, alias, "FAST");
};

const drawTextLines = (
  pdf: import("jspdf").jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxLines: number,
  lineHeight: number
) => {
  const lines = pdf.splitTextToSize(text, maxWidth).slice(0, maxLines);
  pdf.text(lines, x, y);
  return y + lines.length * lineHeight;
};

export const generatePDFVersion3 = async (
  rows: ProductRow[],
  selectedFields: SelectedFields,
  companyName: string,
  onProgress?: PDFProgressCallback
) => {
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF("p", "mm", "a4");
  const products = rows.filter(isProductRow);
  const imageCache = version3ImageCache;
  onProgress?.(5);

  const uniqueImages = new Map<string, string>();
  if (selectedFields.image) {
    products.forEach((row) => {
      const imageSource =
        cleanValue(row.imageUrl) || cleanValue(row.previewUrl);
      if (!imageSource) return;

      const optimizedSource = buildCloudinaryDeliveryUrl(
        imageSource,
        CLOUDINARY_PDF_TRANSFORMATION
      );
      uniqueImages.set(
        getCloudinaryAssetKey(optimizedSource),
        optimizedSource
      );
    });
  }

  await preloadWithConcurrency(
    [...uniqueImages.entries()],
    ([cacheKey, source]) =>
      loadImage(source, imageCache, cacheKey),
    (completed, total) =>
      onProgress?.(imageLoadProgress(completed, total))
  );
  if (uniqueImages.size === 0) onProgress?.(80);
  const generatedAt = new Date();
  const displayDate = formatDate(generatedAt);

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 8;
  const headerY = 7;
  const headerHeight = 12;
  const cardTopY = 24;
  const footerHeight = 11;
  const cardGap = 5;
  const cardWidth = (pageWidth - marginX * 2 - cardGap) / 2;
  const cardHeight = (pageHeight - cardTopY - footerHeight - cardGap) / 2;
  const productsPerPage = 4;
  const totalPages = Math.max(1, Math.ceil(products.length / productsPerPage));
  const safeCompanyName = cleanValue(companyName) || "Gopalam Gems & Jewellery";

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

  const drawDetails = (row: ProductRow, x: number, y: number, width: number, height: number) => {
    const padding = 3;
    const leftWidth = selectedFields.barcode ? 35 : 27;
    const rightX = x + padding + leftWidth + 4;
    const rightWidth = width - padding * 2 - leftWidth - 4;
    const itemNo = displayValue(row.data?.ITEMNO);
    const barcode = cleanValue(row.barcode);

    pdf.setTextColor(35, 35, 35);

    let leftY = y + 5;
    if (selectedFields.item) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.4);
      leftY = drawTextLines(pdf, `SKU: ${itemNo}`, x + padding, leftY, leftWidth, 2, 3.5);
    }

    if (selectedFields.barcode && barcode) {
      const barcodeY = Math.min(y + height - 18, leftY + 2);
      drawCode128Barcode(pdf, barcode, x + padding, barcodeY, leftWidth, 10);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(6.5);
      pdf.text(barcode, x + padding + leftWidth / 2, barcodeY + 13.2, { align: "center" });
    }

    pdf.setFontSize(7.1);
    let detailY = y + 5;

    rightDetailFields
      .filter((field) => selectedFields[field])
      .forEach((field) => {
        if (detailY > y + height - 4) return;

        const value = displayValue(getFieldValue(row, field));
        pdf.setFont("helvetica", "bold");
        const label = `${fieldLabels[field]}: `;
        pdf.text(label, rightX, detailY);

        pdf.setFont("helvetica", "normal");
        const valueX = rightX + pdf.getTextWidth(label);
        const availableWidth = Math.max(8, rightWidth - pdf.getTextWidth(label));
        const maxLines = field === "stone" ? 2 : 1;
        const lines = pdf.splitTextToSize(value, availableWidth).slice(0, maxLines);
        pdf.text(lines, valueX, detailY);
        detailY += lines.length * 3.6;
      });
  };

  const drawCard = async (row: ProductRow, indexOnPage: number, productIndex: number) => {
    const column = indexOnPage % 2;
    const cardRow = Math.floor(indexOnPage / 2);
    const x = marginX + column * (cardWidth + cardGap);
    const y = cardTopY + cardRow * (cardHeight + cardGap);
    const padding = 3;
    const detailHeight = selectedFields.image ? 36 : cardHeight - padding * 2;
    const imageHeight = selectedFields.image ? cardHeight - detailHeight - padding * 2 : 0;

    pdf.setDrawColor(35, 35, 35);
    pdf.setLineWidth(0.35);
    pdf.rect(x, y, cardWidth, cardHeight);

    if (selectedFields.image) {
      const imageX = x + padding;
      const imageY = y + padding;
      const imageWidth = cardWidth - padding * 2;
      const imageSrc = cleanValue(row.imageUrl) || cleanValue(row.previewUrl);
      const optimizedImageSrc = buildCloudinaryDeliveryUrl(
        imageSrc,
        CLOUDINARY_PDF_TRANSFORMATION
      );
      const imageCacheKey = getCloudinaryAssetKey(optimizedImageSrc);
      const image = optimizedImageSrc
        ? await loadImage(optimizedImageSrc, imageCache, imageCacheKey)
        : null;

      if (image) {
        drawImageContain(
          pdf,
          image,
          imageX,
          imageY,
          imageWidth,
          imageHeight,
          `version3_${productIndex}_${cleanValue(row.barcode)}`
        );
      } else {
        pdf.setDrawColor(215, 215, 215);
        pdf.rect(imageX, imageY, imageWidth, imageHeight);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(130, 130, 130);
        pdf.text("Image unavailable", imageX + imageWidth / 2, imageY + imageHeight / 2, {
          align: "center",
        });
      }
    }

    const detailsY = selectedFields.image ? y + cardHeight - detailHeight : y + padding;
    pdf.setDrawColor(35, 35, 35);
    pdf.line(x, detailsY, x + cardWidth, detailsY);
    drawDetails(row, x, detailsY, cardWidth, detailHeight);
  };

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    if (pageIndex > 0) pdf.addPage();

    drawHeaderFooter(pageIndex + 1);

    const pageProducts = products.slice(
      pageIndex * productsPerPage,
      pageIndex * productsPerPage + productsPerPage
    );

    for (let index = 0; index < pageProducts.length; index += 1) {
      await drawCard(pageProducts[index], index, pageIndex * productsPerPage + index);
      onProgress?.(
        pdfDrawProgress(
          pageIndex * productsPerPage + index + 1,
          products.length
        )
      );
    }
  }

  const filenameCompany = safeFilenamePart(safeCompanyName);
  const filenamePrefix = filenameCompany ? `${filenameCompany}_` : "";

  onProgress?.(100);
  pdf.save(`${filenamePrefix}Gopalam_Catalogue_Version_3_${fileDate(generatedAt)}.pdf`);
  version3ImageCache.clear();
};
