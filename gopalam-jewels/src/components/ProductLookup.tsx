"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { calculateTotals } from "@/utils/calculateTotals";
import ProductTable from "@/components/productTable";
import ExcelUpload from "@/components/ExcelUpload";
import QRCodeExcelUpload from "@/components/QRCodeExcelUpload";
import { resolveProductImage } from "@/utils/resolveProductImage";
import { applyDiscount } from "@/utils/applyDiscount";
import { getFileUploadKey } from "@/utils/cloudinaryDelivery";
import {
  uploadProductImage,
  type UploadedProductImage,
} from "@/utils/uploadProductImage";
import { normalizeBarcode } from "@/utils/normalizeBarcode";
import { normalizeStoredImageUrl } from "@/utils/normalizeStoredImageUrl";
import { parseQRCode } from "@/utils/qrProductData";
import {
  clearScannerRows,
  readScannerRows,
  writeScannerRows,
} from "@/utils/scannerRowStorage";

const createEmptyRow = () => ({
  qrCode: "",
  barcode: "",
  imageUrl: "",
  previewUrl: "",
  data: null,
});

const normalizeItemNo = (value: unknown) =>
  String(value || "").trim().toUpperCase();

const hasRowImage = (row: any) =>
  Boolean(String(row.imageUrl || row.previewUrl || "").trim());

const isValidProductRow = (row: any) =>
  Boolean(row.barcode || row.qrCode || row.data);

const getImageFilterStatus = (row: any): "present" | "missing" => {
  if (row.__imageFilterStatus === "missing") return "missing";
  return normalizeStoredImageUrl(row.imageUrl) ? "present" : "missing";
};

const stripDisplayMetadata = (row: any) => {
  const cleanRow = { ...row };
  delete cleanRow.__originalIndex;
  return cleanRow;
};

const getExcelText = (value: unknown) => String(value ?? "").trim();

const getRowBarcode = (row: any) =>
  normalizeBarcode(row.barcode || row.data?.BARCODE);

const getRowQRCode = (row: any) => {
  const existingQRCode = getExcelText(row.qrCode);
  if (existingQRCode) return existingQRCode;

  const data = row.data || {};
  return [
    getRowBarcode(row),
    data.ITEMNO,
    data["STONE NAME"],
    data["GROSS WT"],
    data["STONE WT"],
    data["DAI WT"],
    data["TAG PRICE"],
    data.SIZE,
    data.USD,
  ].map(getExcelText).join(",");
};

const downloadSingleColumnWorkbook = (
  header: "BARCODE" | "qrCode",
  values: string[],
  filename: string
) => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    [header],
    ...values.map((value) => [value]),
  ]);
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  XLSX.writeFile(workbook, filename, { compression: true });
};

const getUniqueItemNoRows = (rows: any[]) => {
  const uniqueRows: any[] = [];
  const rowIndexByIdentity = new Map<string, number>();

  rows.forEach((row, index) => {
    const itemNo = normalizeItemNo(row.data?.ITEMNO);
    const barcode = normalizeItemNo(row.barcode);
    const identity = itemNo || `BARCODE:${barcode || index}`;
    const existingIndex = rowIndexByIdentity.get(identity);

    if (existingIndex === undefined) {
      rowIndexByIdentity.set(identity, uniqueRows.length);
      uniqueRows.push(row);
      return;
    }

    if (!hasRowImage(uniqueRows[existingIndex]) && hasRowImage(row)) {
      uniqueRows[existingIndex] = row;
    }
  });

  return uniqueRows;
};

export default function ProductPanel() {
  const [rows, setRows] = useState<any[]>([createEmptyRow()]);
  const [priceDiscountPercent, setPriceDiscountPercent] = useState(0);
  const [usdDiscountPercent, setUsdDiscountPercent] = useState(0);

  const lastQRRef = useRef<HTMLInputElement>(null);
  const lastBarcodeRef = useRef<HTMLInputElement>(null);
  const scannerUploadCacheRef = useRef(
    new Map<string, Promise<UploadedProductImage>>()
  );
  const activeImageUploadTasksRef = useRef(new Set<Promise<void>>());
  const qrLookupCacheRef = useRef(
    new Map<string, Promise<any>>()
  );
  const qrLookupTimeoutsRef = useRef(new Map<number, number>());
  const qrRowTimeoutsRef = useRef(new Map<number, number>());
  const qrLookupTasksRef = useRef(new Map<number, Promise<void>>());
  const scannerRowsSaveTimeoutRef = useRef<number | null>(null);
  const latestRowsRef = useRef(rows);
  const isWindowUnloadingRef = useRef(false);
  const previousRowsLengthRef = useRef(rows.length);
  const hasLoadedScannerRowsRef = useRef(false);
  const skipNextScannerRowsSaveRef = useRef(false);
  const [focusField, setFocusField] = useState<"qr" | "barcode">("qr");
  const [companyName, setCompanyName] = useState("");
  const [pdfVersion, setPdfVersion] =
    useState<"version1" | "version2" | "version3" | "version4" | "version5">("version1");
  const [pdfGridRows, setPdfGridRows] = useState("6");
  const [pdfGridColumns, setPdfGridColumns] = useState("5");
  const [pdfGridError, setPdfGridError] = useState("");
  const [uniqueItemNoForPDF, setUniqueItemNoForPDF] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [imageFilter, setImageFilter] =
    useState<"all" | "present" | "missing">("all");

  useEffect(() => {
    const clearScannerRowsOnRefresh = () => {
      isWindowUnloadingRef.current = true;
      clearScannerRows();
    };

    window.addEventListener("beforeunload", clearScannerRowsOnRefresh);

    return () => {
      window.removeEventListener("beforeunload", clearScannerRowsOnRefresh);
    };
  }, []);

  useEffect(() => {
    const storedRows = readScannerRows();

    if (storedRows.length > 0) {
      setRows(storedRows);
      latestRowsRef.current = storedRows;
      previousRowsLengthRef.current = storedRows.length;
    }
    hasLoadedScannerRowsRef.current = true;
  }, []);

  useEffect(() => {
    latestRowsRef.current = rows;
    if (!hasLoadedScannerRowsRef.current) return;

    if (skipNextScannerRowsSaveRef.current) {
      skipNextScannerRowsSaveRef.current = false;
      return;
    }

    if (scannerRowsSaveTimeoutRef.current) {
      window.clearTimeout(scannerRowsSaveTimeoutRef.current);
    }
    scannerRowsSaveTimeoutRef.current = window.setTimeout(() => {
      writeScannerRows(latestRowsRef.current);
      scannerRowsSaveTimeoutRef.current = null;
    }, 250);

    return () => {
      if (scannerRowsSaveTimeoutRef.current) {
        window.clearTimeout(scannerRowsSaveTimeoutRef.current);
        scannerRowsSaveTimeoutRef.current = null;
      }
    };
  }, [rows]);

  useEffect(() => () => {
    qrLookupTimeoutsRef.current.forEach((timeout) =>
      window.clearTimeout(timeout)
    );
    qrRowTimeoutsRef.current.forEach((timeout) =>
      window.clearTimeout(timeout)
    );

    if (!isWindowUnloadingRef.current && hasLoadedScannerRowsRef.current) {
      writeScannerRows(latestRowsRef.current);
    }
  }, []);

  const lookupQRProduct = async (
    index: number,
    qrValue: string,
    parsed: ReturnType<typeof parseQRCode>
  ) => {
    const barcode = normalizeBarcode(parsed.BARCODE);
    const itemNo = normalizeItemNo(parsed.ITEMNO);
    const cacheKey = `${barcode}|${itemNo}`;

    try {
      if (!qrLookupCacheRef.current.has(cacheKey)) {
        qrLookupCacheRef.current.set(
          cacheKey,
          fetch("/api/saved-products/lookup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              barcodes: barcode ? [barcode] : [],
              itemNos: itemNo ? [itemNo] : [],
            }),
          }).then(async (response) => {
            const data = await response.json();
            if (!response.ok) {
              throw new Error(data.error || "QR lookup failed");
            }
            return data;
          })
        );
      }

      const lookupData = await qrLookupCacheRef.current.get(cacheKey)!;
      const matchedProducts = Array.isArray(lookupData.products)
        ? lookupData.products
        : [];
      const match = matchedProducts.find(
        (product: any) => normalizeBarcode(product.barcode) === barcode
      );
      const fallbackProduct = {
        barcode,
        data: parsed,
        imageCatalogueImage: lookupData.itemImages?.[itemNo] || "",
      };
      const matchedImage = resolveProductImage(
        match || fallbackProduct,
        matchedProducts
      );

      setRows((currentRows) =>
        currentRows.map((row, currentIndex) =>
          currentIndex === index && row.qrCode === qrValue
            ? {
                ...row,
                barcode: normalizeBarcode(match?.barcode || barcode),
                data: match?.data || parsed,
                imageUrl: matchedImage,
                previewUrl: matchedImage,
              }
            : row
        )
      );
    } catch (error) {
      qrLookupCacheRef.current.delete(cacheKey);
      console.error("QR lookup failed:", error);
    }
  };

  const handleQRScan = (index: number, value: string) => {
    const updated = rows.map((row, currentIndex) =>
      currentIndex === index ? { ...row, qrCode: value } : row
    );
    // Only process when we have a full QR code (at least 6-7 parts)
    const parts = value.split(",").map(p => p.trim());

    if (parts.length >= 6) {
      const parsed = parseQRCode(value);
      updated[index].barcode = parsed.BARCODE;
      updated[index].data = parsed;
      updated[index].imageUrl = "";
      updated[index].previewUrl = "";

      const previousLookup = qrLookupTimeoutsRef.current.get(index);
      if (previousLookup) window.clearTimeout(previousLookup);
      qrLookupTimeoutsRef.current.set(
        index,
        window.setTimeout(() => {
          qrLookupTimeoutsRef.current.delete(index);
          const lookupTask = lookupQRProduct(index, value, parsed);
          qrLookupTasksRef.current.set(index, lookupTask);
          lookupTask.finally(() => {
            if (qrLookupTasksRef.current.get(index) === lookupTask) {
              qrLookupTasksRef.current.delete(index);
            }
          });
        }, 120)
      );
    } else {
      // Partial input - just update QR, don't parse or add row
      updated[index].barcode = "";
      updated[index].data = null;
      updated[index].imageUrl = "";
      updated[index].previewUrl = "";
      const previousLookup = qrLookupTimeoutsRef.current.get(index);
      if (previousLookup) {
        window.clearTimeout(previousLookup);
        qrLookupTimeoutsRef.current.delete(index);
      }
    }
    setFocusField("qr");
    // Auto add new row only after full valid scan
    if (index === rows.length - 1 && value.includes(",") && value.split(",").length >= 4) {
      const previousRowTimeout = qrRowTimeoutsRef.current.get(index);
      if (previousRowTimeout) window.clearTimeout(previousRowTimeout);
      qrRowTimeoutsRef.current.set(
        index,
        window.setTimeout(() => {
          qrRowTimeoutsRef.current.delete(index);
          setRows((prevRows) => {
            if (prevRows.length === index + 1) {
              return [...prevRows, createEmptyRow()];
            }
            return prevRows;
          });
        }, 1000)
      );
    }

    setRows(updated);
  };

  // Auto focus on newest row
  useEffect(() => {
    const previousRowsLength = previousRowsLengthRef.current;
    previousRowsLengthRef.current = rows.length;

    if (rows.length <= previousRowsLength) return;

    if (rows.length > 0) {
      const timeout = setTimeout(() => {
        if (focusField === "qr") {
          lastQRRef.current?.focus({ preventScroll: true });
        } else {
          lastBarcodeRef.current?.focus({ preventScroll: true });
        }
      }, 1000);

      return () => clearTimeout(timeout);
    }
  }, [rows.length, focusField]);

  // Adding this for barcode manual input in case QR code is not scanning properly. This allows users to type or paste the barcode and it will fetch data from saved products if available. 
  const handleManualBarcode = (index: number, value: string) => {
    setRows((currentRows) =>
      currentRows.map((row, currentIndex) =>
        currentIndex === index
          ? {
              ...row,
              barcode: value,
              data: null,
              imageUrl: "",
              previewUrl: "",
            }
          : row
      )
    );
  };

  const handleBarcodeLookup = async (index: number, value: string) => {
    const barcode = normalizeBarcode(value);
    if (!barcode) return;

    try {
      const response = await fetch("/api/saved-products/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcodes: [barcode] }),
      });
      const lookupData = await response.json();

      if (!response.ok) {
        throw new Error(lookupData.error || "Barcode lookup failed");
      }

      const match = Array.isArray(lookupData.products)
        ? lookupData.products[0]
        : null;

      setFocusField("barcode");
      setRows((currentRows) => {
        const currentRow = currentRows[index];
        if (!currentRow || normalizeBarcode(currentRow.barcode) !== barcode) {
          return currentRows;
        }

        const nextRows = [...currentRows];
        if (!match) {
          nextRows[index] = {
            ...currentRow,
            data: null,
            imageUrl: "",
            previewUrl: "",
          };
          return nextRows;
        }

        const matchedImage = resolveProductImage(match, [
          match,
        ]);
        nextRows[index] = {
          ...currentRow,
          barcode: normalizeBarcode(match.barcode),
          data: match.data,
          imageUrl: matchedImage,
          previewUrl: matchedImage,
        };

        if (index === currentRows.length - 1) {
          nextRows.push(createEmptyRow());
        }

        return nextRows;
      });
    } catch (error) {
      console.error("Barcode lookup failed:", error);
    }
  };

  const handleImage = (index: number, file: File) => {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    const selectedRow = latestRowsRef.current[index] || rows[index];
    const selectedItemNo = normalizeItemNo(selectedRow?.data?.ITEMNO);
    const keepMatchingRowsInMissing = imageFilter === "missing";

    setRows((currentRows) => {
      const nextRows = currentRows.map((row, currentIndex) =>
        currentIndex === index
          ? {
              ...row,
              previewUrl,
              __imageFilterStatus:
                imageFilter === "missing"
                  ? "missing"
                  : row.__imageFilterStatus,
            }
          : row
      );
      latestRowsRef.current = nextRows;
      return nextRows;
    });

    const uploadTask = uploadImage(
      file,
      index,
      previewUrl,
      selectedItemNo,
      keepMatchingRowsInMissing
    );
    activeImageUploadTasksRef.current.add(uploadTask);
    uploadTask.finally(() => {
      activeImageUploadTasksRef.current.delete(uploadTask);
    });
  };

  const uploadImage = async (
    file: File,
    index: number,
    previewUrl: string,
    selectedItemNo: string,
    keepMatchingRowsInMissing: boolean
  ) => {
    const row = latestRowsRef.current[index] || rows[index];
    const uploadScope = String(
      row?.data?.ITEMNO || row?.barcode || ""
    ).trim();
    const uploadKey = await getFileUploadKey(file, uploadScope);

    try {
      if (!scannerUploadCacheRef.current.has(uploadKey)) {
        scannerUploadCacheRef.current.set(
          uploadKey,
          uploadProductImage(file)
        );
      }

      const uploadedImage = await scannerUploadCacheRef.current.get(uploadKey)!;
      const imageUrl = uploadedImage.imageUrl;
      setRows((currentRows) => {
        const nextRows = currentRows.map((currentRow) => {
          const isSelectedRow = currentRow.previewUrl === previewUrl;
          const hasMatchingItemNo = Boolean(
            selectedItemNo &&
            normalizeItemNo(currentRow.data?.ITEMNO) === selectedItemNo
          );

          if (!isSelectedRow && !hasMatchingItemNo) return currentRow;

          const wasMissing = getImageFilterStatus(currentRow) === "missing";
          const hasAnotherPendingPreview = Boolean(
            !isSelectedRow &&
            String(currentRow.previewUrl || "").startsWith("blob:")
          );

          if (hasAnotherPendingPreview) return currentRow;

          return {
            ...currentRow,
            imageUrl,
            ...(Object.prototype.hasOwnProperty.call(uploadedImage, "r2Image")
              ? { r2Image: uploadedImage.r2Image || "" }
              : {}),
            previewUrl: isSelectedRow
              ? currentRow.previewUrl
              : imageUrl,
            __imageFilterStatus:
              keepMatchingRowsInMissing && wasMissing
                ? "missing"
                : currentRow.__imageFilterStatus,
          };
        });
        latestRowsRef.current = nextRows;
        return nextRows;
      });
    } catch (err) {
      scannerUploadCacheRef.current.delete(uploadKey);
      console.error(err);
    }
  };

  const saveAll = async (rowsToSave: any[] = rows) => {
    if (activeImageUploadTasksRef.current.size > 0) {
      await Promise.allSettled([...activeImageUploadTasksRef.current]);
    }
    if (qrLookupTimeoutsRef.current.size > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    if (qrLookupTasksRef.current.size > 0) {
      await Promise.allSettled([...qrLookupTasksRef.current.values()]);
    }

    const latestRowsByBarcode = new Map(
      latestRowsRef.current
        .filter((row) => normalizeBarcode(row.barcode))
        .map((row) => [normalizeBarcode(row.barcode), row])
    );
    const currentRowsToSave = rowsToSave.map(
      (row) => latestRowsByBarcode.get(normalizeBarcode(row.barcode)) || row
    );
    const toSave = currentRowsToSave.filter(r => r.barcode && r.data).map(r => ({
      barcode: r.barcode,
      image: r.imageUrl || "",
      data: r.data,
      ...(Object.prototype.hasOwnProperty.call(r, "r2Image")
        ? { r2Image: String(r.r2Image || "") }
        : {}),
    }));

    if (toSave.length === 0) return alert("No products to save");

    try {
      const res = await fetch("/api/saved-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: toSave }),
      });

      if (res.ok) {
        alert(`✅ ${toSave.length} products saved!`);
        const savedImageBarcodes = new Set(
          toSave
            .filter((product) => normalizeStoredImageUrl(product.image))
            .map((product) => normalizeBarcode(product.barcode))
        );

        if (savedImageBarcodes.size > 0) {
          setRows((currentRows) => {
            const nextRows = currentRows.map((row) => {
              if (
                row.__imageFilterStatus !== "missing" ||
                !savedImageBarcodes.has(normalizeBarcode(row.barcode)) ||
                !normalizeStoredImageUrl(row.imageUrl)
              ) {
                return row;
              }

              const updatedRow = { ...row };
              delete updatedRow.__imageFilterStatus;
              return updatedRow;
            });
            latestRowsRef.current = nextRows;
            return nextRows;
          });
        }
      }
    } catch (err) {
      alert("Save failed");
    }
  };

  const [selectedFields, setSelectedFields] = useState({
    image: true,
    barcode: true,
    item: true,
    stone: true,
    gross: true,
    stoneWt: true,
    dai: true,
    price: true,
    usd: true,
    size: true,
  });

  const [showPopup, setShowPopup] = useState(false);
  const validProductRows = useMemo(
    () => rows.filter(isValidProductRow),
    [rows]
  );
  const allProductsCount = validProductRows.length;
  const imagesPresentCount = validProductRows.filter(
    (row) => getImageFilterStatus(row) === "present"
  ).length;
  const imagesMissingCount = validProductRows.filter(
    (row) => getImageFilterStatus(row) === "missing"
  ).length;

  const filteredRows = useMemo(
    () => rows
      .map((row, originalIndex) => ({ ...row, __originalIndex: originalIndex }))
      .filter((row) => {
        if (!isValidProductRow(row)) return true;
        if (imageFilter === "present") {
          return getImageFilterStatus(row) === "present";
        }
        if (imageFilter === "missing") {
          return getImageFilterStatus(row) === "missing";
        }
        return true;
      }),
    [imageFilter, rows]
  );

  const missingRowsForExcel = useMemo(
    () => validProductRows.filter((row) =>
      getImageFilterStatus(row) === "missing" && Boolean(getRowBarcode(row))
    ),
    [validProductRows]
  );

  const downloadMissingBarcodeExcel = () => {
    const barcodes = missingRowsForExcel
      .map(getRowBarcode);

    downloadSingleColumnWorkbook(
      "BARCODE",
      barcodes,
      "products-missing-images-barcodes.xlsx"
    );
  };

  const downloadMissingQRCodeExcel = () => {
    const qrCodes = missingRowsForExcel
      .map(getRowQRCode);

    downloadSingleColumnWorkbook(
      "qrCode",
      qrCodes,
      "products-missing-images-qr-codes.xlsx"
    );
  };

  const getOriginalRowIndex = (displayIndex: number) =>
    filteredRows[displayIndex]?.__originalIndex ?? displayIndex;

  const preparedPdfRows = useMemo(
    () => filteredRows.map(stripDisplayMetadata),
    [filteredRows]
  );
  const pdfRowsPreview = useMemo(
    () => uniqueItemNoForPDF || pdfVersion === "version5"
      ? getUniqueItemNoRows(preparedPdfRows)
      : preparedPdfRows,
    [pdfVersion, preparedPdfRows, uniqueItemNoForPDF]
  );

  const clampDiscountPercent = (value: string) => {
    if (value.trim() === "") return 0;

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;

    return Math.min(100, Math.max(0, numericValue));
  };

  const prepareDiscountedRowsForPDF = (rowsForPdf: any[]) =>
    rowsForPdf.map((row) => {
      if (!row.data) return row;

      const discountedPrice = applyDiscount(
        row.data["TAG PRICE"],
        priceDiscountPercent
      );
      const discountedUSD = applyDiscount(
        row.data.USD,
        usdDiscountPercent
      );
      const hasPrice =
        row.data["TAG PRICE"] !== null &&
        row.data["TAG PRICE"] !== undefined &&
        row.data["TAG PRICE"] !== "";
      const hasUSD =
        row.data.USD !== null &&
        row.data.USD !== undefined &&
        row.data.USD !== "";

      return {
        ...row,
        data: {
          ...row.data,
          "TAG PRICE": hasPrice && Number.isFinite(Number(discountedPrice))
            ? Math.round(Number(discountedPrice))
            : "",
          USD: hasUSD && Number.isFinite(Number(discountedUSD))
            ? Number(discountedUSD).toFixed(2)
            : "",
        },
      };
    });

  const handleDisplayedRowsChange = (nextRows: any[] | ((prevRows: any[]) => any[])) => {
    if (typeof nextRows === "function") {
      setRows((prevRows) => nextRows(prevRows).map(stripDisplayMetadata));
      return;
    }

    if (imageFilter === "all") {
      setRows(nextRows.map(stripDisplayMetadata));
      return;
    }

    const visibleIndexes = new Set(
      filteredRows
        .map((row) => row.__originalIndex)
        .filter((index) => typeof index === "number")
    );

    const remainingVisibleIndexes = new Set(
      nextRows
        .map((row) => row.__originalIndex)
        .filter((index) => typeof index === "number")
    );

    setRows((prevRows) =>
      prevRows.filter((_, index) =>
        !visibleIndexes.has(index) || remainingVisibleIndexes.has(index)
      )
    );
  };

  const removeAllProducts = () => {
    const confirmed = window.confirm("Are you sure you want to remove all products?");

    if (!confirmed) return;

    skipNextScannerRowsSaveRef.current = true;
    clearScannerRows();
    setImageFilter("all");
    setRows([createEmptyRow()]);
  };

  const imageFilterButtons = [
    { key: "all", label: `All Products (${allProductsCount})` },
    { key: "present", label: `Images Present (${imagesPresentCount})` },
    { key: "missing", label: `Images Missing (${imagesMissingCount})` },
  ] as const;

  const totals = useMemo(
    () => calculateTotals(
      filteredRows,
      priceDiscountPercent,
      usdDiscountPercent
    ),
    [filteredRows, priceDiscountPercent, usdDiscountPercent]
  );
  return (
    <div>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "10px"
      }}>
        <div>
          <h2>Barcode Scanner Mode</h2>
          <p style={{ color: "#28a745", fontWeight: "bold" }}>
            Scan QR Code continuously • One row per scan
          </p>
        </div>

        {/* <div>
          <h3>Excel Upload</h3>
          <ExcelUpload setRows={setRows} />
        </div> */}

        <div
          style={{
            display: "flex",
            gap: "20px",
            alignItems: "flex-start",
          }}
        >
          <div>
            <h3>Barcode Excel</h3>
            <ExcelUpload
              setRows={setRows}
            />
          </div>

          <div>
            <h3>QR Excel</h3>
            <QRCodeExcelUpload
              setRows={setRows}
            />
          </div>
        </div>
      </div>

      <div style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        alignItems: "flex-end",
        marginBottom: "10px"
      }}>
        <label style={{ fontSize: "13px", fontWeight: "bold" }}>
          Price Discount (%)
          <input
            type="text"
            inputMode="decimal"
            value={priceDiscountPercent}
            onChange={(event) =>
              setPriceDiscountPercent(
                clampDiscountPercent(event.target.value)
              )
            }
            style={{
              display: "block",
              width: "90px",
              marginTop: "4px",
              padding: "5px 7px"
            }}
          />
        </label>
        <label style={{ fontSize: "13px", fontWeight: "bold" }}>
          USD Discount (%)
          <input
            type="text"
            inputMode="decimal"
            value={usdDiscountPercent}
            onChange={(event) =>
              setUsdDiscountPercent(
                clampDiscountPercent(event.target.value)
              )
            }
            style={{
              display: "block",
              width: "90px",
              marginTop: "4px",
              padding: "5px 7px"
            }}
          />
        </label>
        {imageFilter === "missing" && (
          <>
            <button
              type="button"
              onClick={downloadMissingBarcodeExcel}
              disabled={missingRowsForExcel.length === 0}
              style={{
                backgroundColor: "#3b82f6",
                color: "white",
                padding: "7px 12px",
                border: "none",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: "bold",
                cursor: missingRowsForExcel.length === 0
                  ? "not-allowed"
                  : "pointer",
                opacity: missingRowsForExcel.length === 0 ? 0.6 : 1,
                minHeight: "32px",
                whiteSpace: "nowrap",
              }}
            >
              Download Barcode Excel
            </button>
            <button
              type="button"
              onClick={downloadMissingQRCodeExcel}
              disabled={missingRowsForExcel.length === 0}
              style={{
                backgroundColor: "#3b82f6",
                color: "white",
                padding: "7px 12px",
                border: "none",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: "bold",
                cursor: missingRowsForExcel.length === 0
                  ? "not-allowed"
                  : "pointer",
                opacity: missingRowsForExcel.length === 0 ? 0.6 : 1,
                minHeight: "32px",
                whiteSpace: "nowrap",
              }}
            >
              Download QR Excel
            </button>
          </>
        )}
      </div>

      <ProductTable
        rows={filteredRows}
        setRows={handleDisplayedRowsChange}
        handleQRScan={(index: number, value: string) => handleQRScan(getOriginalRowIndex(index), value)}
        handleManualBarcode={(index: number, value: string) => handleManualBarcode(getOriginalRowIndex(index), value)}
        handleBarcodeLookup={(index: number, value: string) => handleBarcodeLookup(getOriginalRowIndex(index), value)}
        handleImage={(index: number, file: File) => handleImage(getOriginalRowIndex(index), file)}
        lastQRRef={lastQRRef}
        lastBarcodeRef={lastBarcodeRef}
        totals={totals}
        setSelectedImage={setSelectedImage}
        priceDiscountPercent={priceDiscountPercent}
        usdDiscountPercent={usdDiscountPercent}
      />
      {/* 🔥 TOTAL ROW ALIGNED WITH TABLE */}

      <div style={{
        marginTop: "20px",
        padding: "12px",
        border: "1px solid #ccc",
        borderRadius: "6px",
        background: "#f9fafb",
        display: "flex",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "12px"
      }}>
        <strong>Total Products: {totals.count}</strong>
      </div>

      <div style={{
        marginTop: "20px",
        display: "flex",
        gap: "12px",
        flexWrap: "wrap",
        alignItems: "center"
      }}>
        {imageFilterButtons.map((button) => {
          const isActive = imageFilter === button.key;

          return (
            <button
              key={button.key}
              onClick={() => setImageFilter(button.key)}
              style={{
                backgroundColor: isActive ? "#3b82f6" : "#64748b",
                color: "white",
                padding: "10px 14px",
                border: "none",
                borderRadius: "6px",
                fontSize: "14px",
                fontWeight: "bold",
                cursor: "pointer",
                minHeight: "42px",
                whiteSpace: "nowrap"
              }}
            >
              {button.label}
            </button>
          );
        })}
        <button onClick={() => saveAll(filteredRows.map(stripDisplayMetadata))} style={{
          backgroundColor: "#28a745",
          color: "white",
          padding: "10px 14px",
          border: "none",
          borderRadius: "6px",
          fontSize: "14px",
          fontWeight: "bold",
          cursor: "pointer",
          minHeight: "42px",
          whiteSpace: "nowrap"
        }}>
          💾 Save All Products
        </button>
        <button onClick={() => setShowPopup(true)}

          style={{
            backgroundColor: "#3b82f6",
            color: "white",
            padding: "10px 14px",
            border: "none",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
            minHeight: "42px",
            whiteSpace: "nowrap"
          }}
        >Download PDF</button>
        {showPopup && (



          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000
          }}>
            <div style={{
              background: "white",
              padding: "20px",
              borderRadius: "8px",
              minWidth: "300px"
            }}>
              <div style={{ marginBottom: "10px" }}>
                <label style={{ display: "block", fontWeight: "bold" }}>
                  Company Name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Enter Company Name"
                  style={{
                    width: "100%",
                    padding: "6px",
                    marginTop: "4px",
                    borderRadius: "4px",
                    border: "1px solid #ccc"
                  }}
                />
              </div>
              <label style={{ display: "block", marginBottom: "10px" }}>
                <input
                  type="checkbox"
                  checked={uniqueItemNoForPDF}
                  onChange={(event) =>
                    setUniqueItemNoForPDF(event.target.checked)
                  }
                />
                Unique Item No
              </label>
              <h3>Select Fields</h3>

              {Object.keys(selectedFields).map((key) => (
                <label key={key} style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    checked={selectedFields[key as keyof typeof selectedFields]}
                    onChange={() =>
                      setSelectedFields(prev => ({
                        ...prev,
                        [key]: !prev[key as keyof typeof prev]
                      }))
                    }
                  />
                  {key}
                </label>
              ))}

              <div style={{ marginTop: "15px", marginBottom: "10px" }}>
                <h3 style={{ marginBottom: "8px" }}>PDF Layout</h3>
                <label style={{ display: "block", marginBottom: "6px" }}>
                  <input
                    type="radio"
                    name="pdf-layout"
                    value="version1"
                    checked={pdfVersion === "version1"}
                    onChange={() => setPdfVersion("version1")}
                  />
                  Version 1 – Table Layout
                </label>
                <label style={{ display: "block" }}>
                  <input
                    type="radio"
                    name="pdf-layout"
                    value="version2"
                    checked={pdfVersion === "version2"}
                    onChange={() => setPdfVersion("version2")}
                  />
                  Version 2 – Catalogue Layout
                </label>
                <label style={{ display: "block", marginTop: "6px" }}>
                  <input
                    type="radio"
                    name="pdf-layout"
                    value="version3"
                    checked={pdfVersion === "version3"}
                    onChange={() => setPdfVersion("version3")}
                  />
                  Version 3 – Large Product Cards
                </label>
                <label style={{ display: "block", marginTop: "6px" }}>
                  <input
                    type="radio"
                    name="pdf-layout"
                    value="version4"
                    checked={pdfVersion === "version4"}
                    onChange={() => {
                      setPdfVersion("version4");
                      setPdfGridError("");
                    }}
                  />
                  Version 4 – Dynamic Image Grid
                </label>
                <label style={{ display: "block", marginTop: "6px" }}>
                  <input
                    type="radio"
                    name="pdf-layout"
                    value="version5"
                    checked={pdfVersion === "version5"}
                    onChange={() => {
                      setPdfVersion("version5");
                      setPdfGridError("");
                    }}
                  />
                  Version 5 – Unique Item Quantity Grid
                </label>
              </div>

              {(pdfVersion === "version4" || pdfVersion === "version5") && (
                <div style={{ marginBottom: "15px" }}>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <label style={{ flex: 1, fontWeight: "bold" }}>
                      Rows
                      <input
                        type="number"
                        min="1"
                        max="10"
                        step="1"
                        value={pdfGridRows}
                        onChange={(event) => {
                          setPdfGridRows(event.target.value);
                          setPdfGridError("");
                        }}
                        style={{ width: "100%", padding: "6px", marginTop: "4px" }}
                      />
                    </label>
                    <label style={{ flex: 1, fontWeight: "bold" }}>
                      Columns
                      <input
                        type="number"
                        min="1"
                        max="10"
                        step="1"
                        value={pdfGridColumns}
                        onChange={(event) => {
                          setPdfGridColumns(event.target.value);
                          setPdfGridError("");
                        }}
                        style={{ width: "100%", padding: "6px", marginTop: "4px" }}
                      />
                    </label>
                  </div>
                  {pdfGridError && (
                    <p role="alert" style={{ color: "#dc2626", fontSize: "12px", marginTop: "6px" }}>
                      {pdfGridError}
                    </p>
                  )}
                </div>
              )}

              {isGenerating && (
                <div style={{ marginBottom: "15px" }}>
                  <div style={{
                    width: "100%",
                    height: "10px",
                    background: "#e5e7eb",
                    borderRadius: "5px",
                    overflow: "hidden"
                  }}>
                    <div style={{
                      width: `${progress}%`,
                      height: "100%",
                      background: "#3b82f6",
                      transition: "width 0.3s ease"
                    }} />
                  </div>

                  <p style={{ fontSize: "12px", marginTop: "5px" }}>
                    Generating PDF... {progress}%
                  </p>
                </div>
              )}

              <div style={{ marginTop: "15px" }}>
                <p style={{ fontSize: "12px", marginBottom: "8px" }}>
                  PDF Products: {pdfRowsPreview.length}
                </p>
                <button
                  disabled={isGenerating}
                  style={{
                    opacity: isGenerating ? 0.6 : 1,
                    cursor: isGenerating ? "not-allowed" : "pointer"
                  }}
                  onClick={async () => {
                    const gridRows = Number(pdfGridRows);
                    const gridColumns = Number(pdfGridColumns);
                    if (
                      (pdfVersion === "version4" || pdfVersion === "version5") &&
                      (!Number.isInteger(gridRows) ||
                        !Number.isInteger(gridColumns) ||
                        gridRows < 1 ||
                        gridColumns < 1 ||
                        gridRows > 10 ||
                        gridColumns > 10)
                    ) {
                      setPdfGridError("Rows and Columns must be whole numbers from 1 to 10.");
                      return;
                    }

                    setIsGenerating(true);
                    setProgress(0);
                    const handlePdfProgress = (nextProgress: number) =>
                      setProgress(
                        Math.min(100, Math.max(0, nextProgress))
                      );

                    const rowsForPdf = filteredRows.map(stripDisplayMetadata);
                    const currentPdfRows = uniqueItemNoForPDF && pdfVersion !== "version5"
                      ? getUniqueItemNoRows(rowsForPdf)
                      : rowsForPdf;
                    const pdfRows = pdfVersion === "version5"
                      ? currentPdfRows
                      : prepareDiscountedRowsForPDF(currentPdfRows);

                    if (pdfVersion === "version1") {
                      const { generatePDF } = await import("@/utils/generatePDF");
                      await generatePDF(
                        pdfRows,
                        selectedFields,
                        companyName,
                        handlePdfProgress
                      );
                    } else if (pdfVersion === "version2") {
                      const { generatePDFVersion2 } = await import("@/utils/generatePDFVersion2");
                      await generatePDFVersion2(
                        pdfRows,
                        selectedFields,
                        companyName,
                        handlePdfProgress
                      );
                    } else if (pdfVersion === "version3") {
                      const { generatePDFVersion3 } = await import("@/utils/generatePDFVersion3");
                      await generatePDFVersion3(
                        pdfRows,
                        selectedFields,
                        companyName,
                        handlePdfProgress
                      );
                    } else if (pdfVersion === "version4") {
                      const { generatePDFVersion4 } = await import("@/utils/generatePDFVersion4");
                      await generatePDFVersion4(
                        pdfRows,
                        companyName,
                        { rows: gridRows, columns: gridColumns },
                        handlePdfProgress
                      );
                    } else {
                      const { generatePDFVersion5 } = await import("@/utils/generatePDFVersion5");
                      await generatePDFVersion5(
                        pdfRows,
                        companyName,
                        { rows: gridRows, columns: gridColumns },
                        handlePdfProgress
                      );
                    }

                    setProgress(100);

                    setTimeout(() => {
                      setIsGenerating(false);
                      setShowPopup(false);
                      setProgress(0);
                    }, 500);
                  }}
                >
                  Generate PDF
                </button>

                <button onClick={() => setShowPopup(false)} style={{ marginLeft: "10px" }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        {/* New Manual Add Row Button */}
        <button
          onClick={() => {
            setRows(prev => [...prev, createEmptyRow()]);
          }}
          style={{
            backgroundColor: "#64748b",
            color: "white",
            padding: "10px 14px",
            border: "none",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
            minHeight: "42px",
            whiteSpace: "nowrap"
          }}
        >
          + Add Product
        </button>
      </div>

      <div style={{
        marginTop: "12px",
        display: "flex",
        alignItems: "center"
      }}>
        <button
          onClick={removeAllProducts}
          style={{
            backgroundColor: "#dc2626",
            color: "white",
            padding: "10px 14px",
            border: "none",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
            minHeight: "42px",
            whiteSpace: "nowrap"
          }}
        >
          Remove All Products
        </button>
      </div>

      <button
        onClick={() => {
          window.scrollTo({
            top: 0,
            behavior: "smooth"
          });
        }}
        style={{
          position: "fixed",
          right: "24px",
          bottom: "78px",
          zIndex: 900,
          backgroundColor: "#111827",
          color: "white",
          padding: "12px 16px",
          border: "none",
          borderRadius: "999px",
          fontSize: "14px",
          fontWeight: "bold",
          cursor: "pointer",
          boxShadow: "0 10px 25px rgba(0,0,0,0.25)"
        }}
      >
        ↑ Top
      </button>

      <button
        onClick={() => {
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: "smooth"
          });
        }}
        style={{
          position: "fixed",
          right: "24px",
          bottom: "24px",
          zIndex: 900,
          backgroundColor: "#111827",
          color: "white",
          padding: "12px 16px",
          border: "none",
          borderRadius: "999px",
          fontSize: "14px",
          fontWeight: "bold",
          cursor: "pointer",
          boxShadow: "0 10px 25px rgba(0,0,0,0.25)"
        }}
      >
        ↓ Bottom
      </button>

      {selectedImage && (
        <div
          onClick={() => setSelectedImage(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 2000
          }}
        >
          <img
            src={selectedImage}
            alt="zoom"
            style={{
              maxWidth: "90%",
              maxHeight: "90%",
              borderRadius: "10px",
              boxShadow: "0 0 20px black"
            }}
          />
        </div>
      )}
    </div>
  );
}
