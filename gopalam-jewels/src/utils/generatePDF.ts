import jsPDF from "jspdf";

// const compressImage = (src: string, quality = 0.5, maxWidth = 600): Promise<string> => {
//     return new Promise((resolve) => {
//         const img = new Image();
//         img.crossOrigin = "anonymous";
//         img.src = src;

//         img.onload = () => {
//             const canvas = document.createElement("canvas");
//             const scale = maxWidth / img.width;
//             canvas.width = maxWidth;
//             canvas.height = img.height * scale;

//             const ctx = canvas.getContext("2d");
//             ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);

//             const compressed = canvas.toDataURL("image/jpeg", quality);
//             resolve(compressed);
//         };
//     });
// };

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

export const generatePDF = async (rows: any[], selectedFields: Record<string, boolean>) => {
    const { default: jsPDF } = await import("jspdf");
    const pdf = new jsPDF("p", "mm", "a4");

    let y = 20;
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

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.data) continue;
        const d = { ...row.data };

        const padding = 2;

        // wrap text
        const splitText = (text: string, maxWidth: number) => {
            return pdf.splitTextToSize(text, maxWidth);
        };

        // // prepare wrapped content
        // const barcode = splitText(String(row.barcode || ""), 20);
        // const item = splitText(String(d.ITEMNO || ""), 22);
        // const stone = splitText(String(d["STONE NAME"] || ""), 22);
        // const gross = splitText(String(d["GROSS WT"] || ""), 15);
        // const stoneWt = splitText(String(d["STONE WT"] || ""), 15);
        // const dai = splitText(String(d["DAI WT"] || ""), 15);
        // const price = splitText(String(d["TAG PRICE"] || ""), 18);
        // const usd = splitText(String(d.USD || ""), 18);
        // const size = splitText(String(d.SIZE || ""), 18);

        // // find max lines → dynamic row height
        // const maxLines = Math.max(
        //     barcode.length,
        //     item.length,
        //     stone.length,
        //     gross.length,
        //     stoneWt.length,
        //     dai.length,
        //     price.length,
        //     usd.length,
        //     size.length
        // );

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

        // draw border
        pdf.rect(8, y, 195, dynamicHeight);

        // image
        const imgSrc = row.imageUrl || row.previewUrl;

        let compressedImg = null;

        if (imgSrc && selectedFields.image) {
            compressedImg = await compressImage(imgSrc, 0.5, 600);

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

            // if (field === "barcode") value = row.barcode;
            // else if (field === "item") value = d.ITEMNO;
            // else if (field === "stone") value = d["STONE NAME"];
            // else if (field === "gross") value = d["GROSS WT"];
            // else if (field === "stoneWt") value = d["STONE WT"];
            // else if (field === "dai") value = d["DAI WT"];
            // else if (field === "price") value = d["TAG PRICE"];
            // else if (field === "usd") value = d.USD;
            // else if (field === "size") value = d.SIZE;

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

            else if (field === "dai") value = String(d["DAI WT"] || "");
            else if (field === "price") value = String(d["TAG PRICE"] || "");
            else if (field === "usd") value = String(d.USD || "");
            else if (field === "size") value = String(d.SIZE || "");

            const colWidth = colWidthMap[field] - 4;
            // const lines = splitText(String(value || ""), colWidth);
            const lines = pdf.splitTextToSize(value, colWidth);
            centerText(lines, colX[field]);
        });

        // move Y dynamically
        y += dynamicHeight + 5;
    }


    pdf.save("products.pdf");
};