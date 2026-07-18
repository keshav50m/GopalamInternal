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

const fieldLabels: Record<string, string> = {
  barcode: "Barcode",
  item: "Item No",
  stone: "Stone",
  gross: "Gross",
  stoneWt: "St Wt",
  dai: "DAI",
  price: "Price",
  usd: "USD",
  size: "Size",
};

const detailFieldOrder = [
  "barcode",
  "item",
  "stone",
  "gross",
  "stoneWt",
  "dai",
  "price",
  "usd",
  "size",
];

const cleanValue = (value: unknown) => {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim();
  return normalized || "";
};

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

  if (field === "barcode") return cleanValue(row.barcode);
  if (field === "item") return cleanValue(data.ITEMNO);
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

const truncateToWidth = (
  pdf: import("jspdf").jsPDF,
  text: string,
  maxWidth: number
) => {
  if (pdf.getTextWidth(text) <= maxWidth) return text;

  let truncated = text;
  while (truncated.length > 0 && pdf.getTextWidth(`${truncated}...`) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }

  return truncated ? `${truncated}...` : "";
};

const loadImage = async (
  src: string,
  cache: Map<string, Promise<LoadedImage | null>>
) => {
  if (!cache.has(src)) {
    cache.set(
      src,
      new Promise<LoadedImage | null>(async (resolve) => {
        try {
          const response = await fetch(src);
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);

          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement("canvas");
            const maxDimension = 900;
            const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));

            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));

            const context = canvas.getContext("2d");
            context?.drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(objectUrl);

            resolve({
              dataUrl: canvas.toDataURL("image/jpeg", 0.82),
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
  }

  return cache.get(src);
};

export const generatePDFVersion2 = async (
  rows: ProductRow[],
  selectedFields: SelectedFields,
  companyName: string
) => {
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF("p", "mm", "a4");
  const products = rows.filter(isProductRow);
  const imageCache = new Map<string, Promise<LoadedImage | null>>();

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 8;
  const topY = 24;
  const bottomY = 14;
  const columnGap = 5;
  const rowGap = 4;
  const cardWidth = (pageWidth - marginX * 2 - columnGap) / 2;
  const cardHeight = (pageHeight - topY - bottomY - rowGap * 3) / 4;
  const productsPerPage = 8;
  const safeCompanyName = cleanValue(companyName);
  const totalPages = Math.max(1, Math.ceil(products.length / productsPerPage));

  const drawHeader = (pageNumber: number) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.setTextColor(34, 34, 34);
    pdf.text(safeCompanyName, pageWidth / 2, 13, { align: "center" });

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(110, 110, 110);
    pdf.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - marginX, pageHeight - 6, {
      align: "right",
    });
  };

  const drawDetails = (
    row: ProductRow,
    x: number,
    y: number,
    width: number,
    height: number
  ) => {
    const activeDetails = detailFieldOrder
      .filter((field) => selectedFields[field])
      .map((field) => ({
        label: fieldLabels[field],
        value: getFieldValue(row, field),
      }))
      .filter((field) => field.value);

    if (activeDetails.length === 0) return;

    const innerX = x + 3;
    const innerY = y + 4;
    const detailGap = 3;
    const detailColumnWidth = (width - 6 - detailGap) / 2;
    const lineHeight = 3.6;

    pdf.setFontSize(7.2);
    pdf.setTextColor(45, 45, 45);

    activeDetails.forEach((field, index) => {
      const column = index % 2;
      const detailRow = Math.floor(index / 2);
      const textX = innerX + column * (detailColumnWidth + detailGap);
      const textY = innerY + detailRow * lineHeight;
      const maxTextWidth = detailColumnWidth - 1;

      if (textY > y + height - 2) return;

      pdf.setFont("helvetica", "bold");
      const label = `${field.label}: `;
      pdf.text(label, textX, textY);

      pdf.setFont("helvetica", "normal");
      const valueX = textX + pdf.getTextWidth(label);
      const availableWidth = Math.max(6, maxTextWidth - pdf.getTextWidth(label));
      pdf.text(truncateToWidth(pdf, field.value, availableWidth), valueX, textY);
    });
  };

  const drawProductCard = async (row: ProductRow, indexOnPage: number) => {
    const column = indexOnPage % 2;
    const cardRow = Math.floor(indexOnPage / 2);
    const x = marginX + column * (cardWidth + columnGap);
    const y = topY + cardRow * (cardHeight + rowGap);
    const padding = 3;
    const selectedDetailCount = detailFieldOrder.filter((field) => selectedFields[field]).length;
    const detailRows = Math.ceil(selectedDetailCount / 2);
    const detailHeight = Math.min(
      selectedFields.image ? 23 : cardHeight - padding * 2,
      Math.max(15, detailRows * 3.6 + 7)
    );
    const imageAreaHeight = selectedFields.image
      ? cardHeight - detailHeight - padding * 2
      : 0;

    pdf.setDrawColor(180, 180, 180);
    pdf.setLineWidth(0.25);
    pdf.roundedRect(x, y, cardWidth, cardHeight, 1.5, 1.5);

    if (selectedFields.image) {
      const imageSrc = cleanValue(row.imageUrl) || cleanValue(row.previewUrl);
      const image = imageSrc ? await loadImage(imageSrc, imageCache) : null;

      if (image) {
        const imageBoxX = x + padding;
        const imageBoxY = y + padding;
        const imageBoxWidth = cardWidth - padding * 2;
        const imageBoxHeight = imageAreaHeight;
        const scale = Math.min(imageBoxWidth / image.width, imageBoxHeight / image.height);
        const renderedWidth = image.width * scale;
        const renderedHeight = image.height * scale;
        const imageX = imageBoxX + (imageBoxWidth - renderedWidth) / 2;
        const imageY = imageBoxY + (imageBoxHeight - renderedHeight) / 2;

        pdf.addImage(
          image.dataUrl,
          "JPEG",
          imageX,
          imageY,
          renderedWidth,
          renderedHeight,
          `catalogue_${indexOnPage}_${cleanValue(row.barcode)}`,
          "FAST"
        );
      }
    }

    const detailsY = selectedFields.image ? y + cardHeight - detailHeight : y + padding;
    pdf.setDrawColor(220, 220, 220);
    pdf.line(x + padding, detailsY, x + cardWidth - padding, detailsY);
    drawDetails(row, x, detailsY, cardWidth, detailHeight);
  };

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    if (pageIndex > 0) pdf.addPage();
    drawHeader(pageIndex + 1);

    const pageProducts = products.slice(
      pageIndex * productsPerPage,
      pageIndex * productsPerPage + productsPerPage
    );

    for (let index = 0; index < pageProducts.length; index += 1) {
      await drawProductCard(pageProducts[index], index);
    }
  }

  pdf.save("products-catalogue.pdf");
};
