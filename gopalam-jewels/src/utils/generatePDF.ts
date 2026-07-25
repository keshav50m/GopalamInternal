import jsPDF from "jspdf";
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


const compressImage = async (src: string, quality = 0.5, maxWidth = 600) => {
    const response = await fetch(src);
    const blob = await response.blob();

    return new Promise<string>((resolve) => {
        const img = new Image();
        img.src = URL.createObjectURL(blob);

        img.onload = () => {
            const canvas = document.createElement("canvas");
            const scale = maxWidth / img.width;

            canvas.width = maxWidth;
            canvas.height = img.height * scale;

            const ctx = canvas.getContext("2d");
            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);

            resolve(canvas.toDataURL("image/jpeg", quality));
        };
    });
};

const version1ImageCache = new Map<string, Promise<string>>();

const getVersion1Image = (source: string) => {
    const optimizedSource = buildCloudinaryDeliveryUrl(
        source,
        CLOUDINARY_PDF_TRANSFORMATION
    );
    const cacheKey = getCloudinaryAssetKey(optimizedSource);

    return getOrCreateBoundedCacheEntry(
        version1ImageCache,
        cacheKey,
        () => compressImage(optimizedSource, 0.5, 600)
    );
};

export const generatePDF = async (rows: any[], selectedFields: Record<string, boolean>, companyName: string
    , onProgress?: PDFProgressCallback
) => {

    const { default: jsPDF } = await import("jspdf");
    const pdf = new jsPDF("p", "mm", "a4");
    onProgress?.(5);

    const uniqueImages = new Map<string, string>();
    if (selectedFields.image) {
        rows.forEach((row) => {
            const source = String(row.imageUrl || row.previewUrl || "").trim();
            if (!source) return;

            const optimizedSource = buildCloudinaryDeliveryUrl(
                source,
                CLOUDINARY_PDF_TRANSFORMATION
            );
            uniqueImages.set(
                getCloudinaryAssetKey(optimizedSource),
                source
            );
        });
    }

    await preloadWithConcurrency(
        [...uniqueImages.values()],
        (source) => getVersion1Image(source),
        (completed, total) =>
            onProgress?.(imageLoadProgress(completed, total))
    );
    if (uniqueImages.size === 0) onProgress?.(80);

    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");

    pdf.text(
        companyName,
        pdf.internal.pageSize.getWidth() / 2,
        15,
        { align: "center" }
    );

    // reset
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");

    const today = new Date().toLocaleDateString();

    pdf.setFontSize(10);
    pdf.text(today, 10, 10); // top-left

    let y = 25;
    const rowHeight = 28;
    const startX = 8;
    const totalWidth = 195;

    // selected fields
    const activeFields = Object.keys(selectedFields).filter(
        (key) => selectedFields[key as keyof typeof selectedFields]
    );

    // column weight (important for spacing)
    const fieldWeights: Record<string, number> = {
        image: 2.2,
        barcode: 1.2,
        item: 2,
        stone: 1.8,
        gross: 1,
        stoneWt: 1,
        dai: 1,
        price: 1.2,
        usd: 1.2,
        size: 1.2
    };

    const totalWeight = activeFields.reduce(
        (sum, f) => sum + (fieldWeights[f] || 1),
        0
    );

    const colX: Record<string, number> = {};
    const colWidthMap: Record<string, number> = {};

    let currentX = startX;

    activeFields.forEach((field) => {
        const width = (fieldWeights[field] / totalWeight) * totalWidth;
        colX[field] = currentX + 2;
        colWidthMap[field] = width;
        currentX += width;
    });
    pdf.setFontSize(8.5);
    pdf.setFont("helvetica", "bold");

    const fieldLabels: Record<string, string> = {
        image: "Image",
        barcode: "Barcode",
        item: "Item No",
        stone: "Stone",
        gross: "Gross",
        stoneWt: "St Wt",
        dai: "DAI",
        price: "Price",
        usd: "USD",
        size: "Size"
    };

    activeFields.forEach((field) => {
        pdf.text(fieldLabels[field], colX[field], y);
    });
    y += 10;
    pdf.setFont("helvetica", "normal");

    const drawableRowCount = rows.filter((row) => row.data).length;
    let drawnRowCount = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.data) continue;
        const d = { ...row.data };

        const padding = 2;

        // wrap text
        const splitText = (text: string, maxWidth: number) => {
            return pdf.splitTextToSize(text, maxWidth);
        };

        let maxLines = 1;

        activeFields.forEach((field) => {
            let value = "";

            if (field === "barcode") value = row.barcode;
            else if (field === "item") value = d.ITEMNO;
            else if (field === "stone") value = d["STONE NAME"];
            else if (field === "gross") {
                value = parseFloat(d["GROSS WT"] || 0).toFixed(3);
            }
            else if (field === "stoneWt") {
                value = parseFloat(d["STONE WT"] || 0).toFixed(2);
            }
            else if (field === "dai") value = d["DAI WT"];
            else if (field === "price") value = d["TAG PRICE"];
            else if (field === "usd") value = d.USD;
            else if (field === "size") value = d.SIZE;
            value = String(value);

            const colWidth = colWidthMap[field] - 4;
            const lines = pdf.splitTextToSize(value, colWidth);

            if (lines.length > maxLines) {
                maxLines = lines.length;
            }
        });

        const dynamicHeight = Math.max(rowHeight, maxLines * 5 + 10);

        // ✅ PAGE BREAK LOGIC (NO ROW CUT)
        if (y + dynamicHeight > 280) {
            pdf.addPage();

            // 👉 company name (ADD THIS)
            pdf.setFontSize(14);
            pdf.setFont("helvetica", "bold");
            pdf.text(
                companyName,
                pdf.internal.pageSize.getWidth() / 2,
                15,
                { align: "center" }
            );

            // 👉 date (already there)
            pdf.setFontSize(10);
            pdf.setFont("helvetica", "normal");
            pdf.text(today, 10, 10);

            // 👉 adjust Y (IMPORTANT)
            y = 25;
            // redraw header on new page
            pdf.setFont("helvetica", "bold");
            activeFields.forEach((field) => {
                pdf.text(fieldLabels[field], colX[field], y);
            });
            y += 10;
            pdf.setFont("helvetica", "normal");
        }

        // draw border
        pdf.rect(8, y, 195, dynamicHeight);

        // image
        const imgSrc = row.imageUrl || row.previewUrl;

        let compressedImg = null;

        if (imgSrc && selectedFields.image) {
            compressedImg = await getVersion1Image(imgSrc);

            pdf.addImage(
                compressedImg,
                "JPEG",
                colX["image"] - 2,
                y,
                colWidthMap["image"],   // 🔥 dynamic width
                dynamicHeight,
                `img_${i}`,
                "FAST"
            );
        }

        const lineHeight = 5;

        const centerText = (lines: string[], x: number) => {
            const textBlockHeight = lines.length * lineHeight;
            const startY = y + (dynamicHeight - textBlockHeight) / 2 + 3;
            pdf.text(lines, x, startY);
        };

        activeFields.forEach((field) => {
            let value = "";

            if (field === "barcode") value = String(row.barcode || "");
            else if (field === "item") value = String(d.ITEMNO || "");
            else if (field === "stone") value = String(d["STONE NAME"] || "");

            else if (field === "gross") {
                const num = parseFloat(d["GROSS WT"] || "0");
                value = num.toLocaleString("en-US", {
                    minimumFractionDigits: 3,
                    maximumFractionDigits: 3
                });  // FORCE STRING
            }

            else if (field === "stoneWt") {
                const num = parseFloat(d["STONE WT"] || "0");
                value = num.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
            }

            else if (field === "dai") {
                const num = parseFloat(d["DAI WT"] || "0");
                value = num.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
            }
            else if (field === "price") value = String(d["TAG PRICE"] || "");
            else if (field === "usd") value = String(d.USD || "");
            else if (field === "size") value = String(d.SIZE || "");

            const colWidth = colWidthMap[field] - 4;
            // const lines = splitText(String(value || ""), colWidth);
            const lines = pdf.splitTextToSize(value, colWidth);
            centerText(lines, colX[field]);
        });

        // move Y dynamically
        y += dynamicHeight + 2.5;
        drawnRowCount += 1;
        onProgress?.(pdfDrawProgress(drawnRowCount, drawableRowCount));
    }
    const pageCount = pdf.getNumberOfPages();

    for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);

        pdf.setFontSize(10);

        pdf.text(
            `${i}/${pageCount}`,
            pdf.internal.pageSize.getWidth() - 10,
            pdf.internal.pageSize.getHeight() - 10
        );
    }

    onProgress?.(100);
    pdf.save("products.pdf");
};
