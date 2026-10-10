"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import GoldExcelUpload, { type GoldExcelRow } from "./GoldExcelUpload";
import GoldProductTable, { type GoldTotals } from "./GoldProductTable";
import ProviderAwareImage from "@/components/ProviderAwareImage";
import { applyDiscount } from "@/utils/applyDiscount";
import { getFileUploadKey } from "@/utils/cloudinaryDelivery";
import {
  isCompleteGoldQR,
  normalizeGoldLotNo,
  parseGoldQRCode,
  type GoldProductData,
} from "@/utils/goldProductData";
import { normalizeBarcode } from "@/utils/normalizeBarcode";
import { normalizeStoredImageUrl } from "@/utils/normalizeStoredImageUrl";
import {
  uploadProductImage,
  type UploadedProductImage,
} from "@/utils/uploadProductImage";
import styles from "./GoldScanner.module.css";
import type { GoldPDFField, GoldPDFVersion } from "@/utils/generateGoldPDF";

const GOLD_ROWS_STORAGE_KEY = "goldScannerRows";

export type GoldScannerRow = {
  id: string;
  qrCode: string;
  barcode: string;
  data: GoldProductData | null;
  image: string;
  r2Image: string;
  imageUrl: string;
  previewUrl: string;
  fallbackImageUrl: string;
  imageRemoved: boolean;
  removingImage: boolean;
};

type GoldLookupProduct = {
  barcode?: string;
  image?: string;
  r2Image?: string;
  resolvedImageUrl?: string;
  fallbackImageUrl?: string;
  catalogueImage?: string;
  catalogueR2Image?: string;
  catalogueResolvedImageUrl?: string;
  catalogueFallbackImageUrl?: string;
  data?: GoldProductData;
  imageRemoved?: boolean;
};

type LotImage = {
  image?: string;
  r2Image?: string;
  resolvedImageUrl?: string;
  fallbackImageUrl?: string;
};

const createEmptyRow = (): GoldScannerRow => ({
  id: crypto.randomUUID(),
  qrCode: "",
  barcode: "",
  data: null,
  image: "",
  r2Image: "",
  imageUrl: "",
  previewUrl: "",
  fallbackImageUrl: "",
  imageRemoved: false,
  removingImage: false,
});

const cleanStoredRow = (row: GoldScannerRow) => ({
  ...row,
  previewUrl: row.previewUrl.startsWith("blob:") ? row.imageUrl : row.previewUrl,
});

const hasPersistentImage = (row: GoldScannerRow) => Boolean(
  normalizeStoredImageUrl(row.imageUrl) ||
  normalizeStoredImageUrl(row.image) ||
  normalizeStoredImageUrl(row.r2Image)
);

const asNumber = (value: unknown) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
};

const getImageFields = (
  product: GoldLookupProduct | undefined,
  lotImage?: LotImage
) => {
  if (product?.imageRemoved) {
    return { image: "", r2Image: "", imageUrl: "", fallbackImageUrl: "" };
  }
  const useProductImage = Boolean(product?.resolvedImageUrl || product?.image || product?.r2Image);
  return {
    image: normalizeStoredImageUrl(
      useProductImage ? product?.image : product?.catalogueImage || lotImage?.image
    ),
    r2Image: normalizeStoredImageUrl(
      useProductImage ? product?.r2Image : product?.catalogueR2Image || lotImage?.r2Image
    ),
    imageUrl: normalizeStoredImageUrl(
      useProductImage
        ? product?.resolvedImageUrl
        : product?.catalogueResolvedImageUrl || lotImage?.resolvedImageUrl
    ),
    fallbackImageUrl: normalizeStoredImageUrl(
      useProductImage
        ? product?.fallbackImageUrl
        : product?.catalogueFallbackImageUrl || lotImage?.fallbackImageUrl
    ),
  };
};

export default function GoldProductLookup() {
  const [rows, setRows] = useState<GoldScannerRow[]>([]);
  const [focusField, setFocusField] = useState<"qr" | "barcode">("qr");
  const [priceDiscountPercent, setPriceDiscountPercent] = useState(0);
  const [usdDiscountPercent, setUsdDiscountPercent] = useState(0);
  const [saving, setSaving] = useState(false);
  const [imageFilter, setImageFilter] = useState<"all" | "present" | "missing">("all");
  const [showPDF, setShowPDF] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [pdfProgress, setPDFProgress] = useState(0);
  const [pdfVersion, setPDFVersion] = useState<GoldPDFVersion>("version1");
  const [pdfGridRows, setPDFGridRows] = useState("6");
  const [pdfGridColumns, setPDFGridColumns] = useState("5");
  const [pdfGridError, setPDFGridError] = useState("");
  const [uniqueLotNoForPDF, setUniqueLotNoForPDF] = useState(false);
  const [selectedPDFFields, setSelectedPDFFields] = useState<Record<GoldPDFField, boolean>>({
    image: true, barcode: true, lotNo: true, karat: true, stone: true,
    nw: true, gw: true, stoneWt: true, diamondWt: true, totalTag: true, usd: true,
  });
  const [error, setError] = useState("");
  const [selectedImage, setSelectedImage] = useState<{ primary: string; fallback: string } | null>(null);
  const latestRowsRef = useRef(rows);
  const lastQRRef = useRef<HTMLInputElement>(null);
  const lastBarcodeRef = useRef<HTMLInputElement>(null);
  const previousRowCountRef = useRef(rows.length);
  const saveTimerRef = useRef<number | null>(null);
  const lookupTimersRef = useRef(new Map<string, number>());
  const uploadCacheRef = useRef(new Map<string, Promise<UploadedProductImage>>());
  const uploadTasksRef = useRef(new Set<Promise<void>>());

  useEffect(() => {
    const clearGoldRowsOnRefresh = () => {
      sessionStorage.removeItem(GOLD_ROWS_STORAGE_KEY);
    };
    window.addEventListener("beforeunload", clearGoldRowsOnRefresh);
    return () => window.removeEventListener("beforeunload", clearGoldRowsOnRefresh);
  }, []);

  useEffect(() => {
    const navigationEntry = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (navigationEntry?.type === "reload") {
      sessionStorage.removeItem(GOLD_ROWS_STORAGE_KEY);
      const initialRows = [createEmptyRow()];
      setRows(initialRows);
      latestRowsRef.current = initialRows;
      previousRowCountRef.current = initialRows.length;
      return;
    }

    try {
      const stored = JSON.parse(sessionStorage.getItem(GOLD_ROWS_STORAGE_KEY) || "[]");
      if (Array.isArray(stored) && stored.length > 0) {
        const restored = stored.map((row) => ({ ...createEmptyRow(), ...row, id: row.id || crypto.randomUUID() }));
        setRows(restored);
        latestRowsRef.current = restored;
        previousRowCountRef.current = restored.length;
      } else {
        const initialRows = [createEmptyRow()];
        setRows(initialRows);
        latestRowsRef.current = initialRows;
        previousRowCountRef.current = initialRows.length;
      }
    } catch (storageError) {
      console.error("Unable to restore Gold scanner rows:", storageError);
      const initialRows = [createEmptyRow()];
      setRows(initialRows);
      latestRowsRef.current = initialRows;
      previousRowCountRef.current = initialRows.length;
    }
  }, []);

  useEffect(() => {
    latestRowsRef.current = rows;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      try {
        sessionStorage.setItem(
          GOLD_ROWS_STORAGE_KEY,
          JSON.stringify(latestRowsRef.current.map(cleanStoredRow))
        );
      } catch (storageError) {
        console.error("Unable to store Gold scanner rows:", storageError);
      }
    }, 250);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [rows]);

  useEffect(() => () => {
    lookupTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    const previousCount = previousRowCountRef.current;
    previousRowCountRef.current = rows.length;
    if (rows.length <= previousCount) return;
    const timer = window.setTimeout(() => {
      (focusField === "qr" ? lastQRRef.current : lastBarcodeRef.current)?.focus({
        preventScroll: true,
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [focusField, rows.length]);

  const lookupProducts = async (barcodes: string[], lotNos: string[] = []) => {
    const response = await fetch("/api/gold/saved-products/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ barcodes, lotNos }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Gold product lookup failed");
    return result as { products: GoldLookupProduct[]; lotImages: Record<string, LotImage> };
  };

  const hydrateRows = async (rowIds: string[], preserveScannedData = false) => {
    const targetRows = latestRowsRef.current.filter((row) => rowIds.includes(row.id));
    const barcodes = targetRows.map((row) => normalizeBarcode(row.barcode)).filter(Boolean);
    const lotNos = targetRows.map((row) => normalizeGoldLotNo(row.data?.["LOT NO"])).filter(Boolean);
    if (barcodes.length === 0 && lotNos.length === 0) return;

    try {
      const lookup = await lookupProducts(barcodes, lotNos);
      const productsByBarcode = new Map(
        lookup.products.map((product) => [normalizeBarcode(product.barcode), product])
      );
      const unresolvedBarcodes = targetRows
        .filter((row) => !row.data && !productsByBarcode.has(normalizeBarcode(row.barcode)))
        .map((row) => normalizeBarcode(row.barcode));
      setRows((current) => current.map((row) => {
        if (!rowIds.includes(row.id)) return row;
        const product = productsByBarcode.get(normalizeBarcode(row.barcode));
        const data = preserveScannedData && row.data ? row.data : product?.data || row.data;
        const lotImage = lookup.lotImages[normalizeGoldLotNo(data?.["LOT NO"])];
        const imageFields = getImageFields(product, lotImage);
        return {
          ...row,
          data,
          barcode: normalizeBarcode(product?.barcode || row.barcode),
          ...imageFields,
          previewUrl: imageFields.imageUrl,
        };
      }));
      setError(unresolvedBarcodes.length > 0
        ? `No saved Gold product found for barcode${unresolvedBarcodes.length === 1 ? "" : "s"}: ${unresolvedBarcodes.join(", ")}`
        : "");
    } catch (lookupError) {
      console.error("Gold lookup failed:", lookupError);
      setError(lookupError instanceof Error ? lookupError.message : "Gold lookup failed");
    }
  };

  const handleQRChange = (index: number, value: string) => {
    const complete = isCompleteGoldQR(value);
    const parsed = complete ? parseGoldQRCode(value) : null;
    const barcode = parsed ? normalizeBarcode(parsed.BARCODE) : "";
    if (parsed) parsed.BARCODE = barcode;
    const rowId = rows[index]?.id;
    if (!rowId) return;

    setFocusField("qr");
    setRows((current) => current.map((row, currentIndex) =>
      currentIndex === index
        ? {
            ...row,
            qrCode: value,
            barcode,
            data: parsed,
            image: complete ? row.image : "",
            r2Image: complete ? row.r2Image : "",
            imageUrl: complete ? row.imageUrl : "",
            previewUrl: complete ? row.previewUrl : "",
            fallbackImageUrl: complete ? row.fallbackImageUrl : "",
          }
        : row
    ));

    const existingTimer = lookupTimersRef.current.get(rowId);
    if (existingTimer) window.clearTimeout(existingTimer);
    if (!complete || !barcode) return;

    lookupTimersRef.current.set(rowId, window.setTimeout(() => {
      lookupTimersRef.current.delete(rowId);
      void hydrateRows([rowId], true);
    }, 120));

    if (index === rows.length - 1) {
      window.setTimeout(() => {
        setRows((current) =>
          current.some((row) => row.id === rowId) && current.at(-1)?.id === rowId
            ? [...current, createEmptyRow()]
            : current
        );
      }, 200);
    }
  };

  const handleBarcodeChange = (index: number, value: string) => {
    setRows((current) => current.map((row, currentIndex) =>
      currentIndex === index
        ? { ...row, barcode: value, data: null, qrCode: "", imageUrl: "", previewUrl: "" }
        : row
    ));
  };

  const handleBarcodeLookup = async (index: number, value: string) => {
    const barcode = normalizeBarcode(value);
    const rowId = rows[index]?.id;
    if (!barcode || !rowId) return;
    setFocusField("barcode");
    await hydrateRows([rowId]);
    setRows((current) => current.at(-1)?.id === rowId ? [...current, createEmptyRow()] : current);
  };

  const handleExcelImport = async (excelRows: GoldExcelRow[]) => {
    let imported = excelRows.map((row) => ({
      ...createEmptyRow(),
      qrCode: row.qrCode,
      barcode: row.barcode,
      data: row.data,
    }));

    try {
      const lookup = await lookupProducts(
        imported.map((row) => normalizeBarcode(row.barcode)),
        imported.map((row) => normalizeGoldLotNo(row.data?.["LOT NO"])).filter(Boolean)
      );
      const productsByBarcode = new Map(
        lookup.products.map((product) => [normalizeBarcode(product.barcode), product])
      );
      const unresolved: string[] = [];
      imported = imported.map((row) => {
        const barcode = normalizeBarcode(row.barcode);
        const product = productsByBarcode.get(barcode);
        const data = row.data || product?.data || null;
        if (!data) unresolved.push(barcode);
        const imageFields = getImageFields(
          product,
          lookup.lotImages[normalizeGoldLotNo(data?.["LOT NO"])]
        );
        return {
          ...row,
          barcode: normalizeBarcode(product?.barcode || barcode),
          data,
          ...imageFields,
          previewUrl: imageFields.imageUrl,
        };
      });
      setError(unresolved.length > 0
        ? `No saved Gold product found for barcode${unresolved.length === 1 ? "" : "s"}: ${unresolved.join(", ")}`
        : "");
    } catch (lookupError) {
      console.error("Gold Excel lookup failed:", lookupError);
      setError(lookupError instanceof Error ? lookupError.message : "Gold Excel lookup failed");
    }

    setRows((current) => {
      const next = current.length === 0 || (
        current.length === 1 && !current[0].barcode && !current[0].qrCode
      )
        ? imported
        : [...current, ...imported];
      const withEmptyRow = [...next, createEmptyRow()];
      latestRowsRef.current = withEmptyRow;
      return withEmptyRow;
    });
  };

  const handleImage = (index: number, file: File) => {
    const row = latestRowsRef.current[index];
    if (!row) return;
    const previewUrl = URL.createObjectURL(file);
    setRows((current) => current.map((item, currentIndex) =>
      currentIndex === index ? { ...item, previewUrl } : item
    ));

    const task = (async () => {
      const uploadKey = await getFileUploadKey(
        file,
        row.data?.["LOT NO"] || row.barcode
      );
      if (!uploadCacheRef.current.has(uploadKey)) {
        uploadCacheRef.current.set(uploadKey, uploadProductImage(file));
      }
      try {
        const uploaded = await uploadCacheRef.current.get(uploadKey)!;
        setRows((current) => current.map((item) =>
          item.id === row.id
            ? {
                ...item,
                image: uploaded.cloudinaryUrl,
                ...(Object.prototype.hasOwnProperty.call(uploaded, "r2Image")
                  ? { r2Image: uploaded.r2Image || "" }
                  : {}),
                imageUrl: uploaded.resolvedImageUrl,
                previewUrl: uploaded.resolvedImageUrl,
                fallbackImageUrl: uploaded.fallbackImageUrl,
                imageRemoved: false,
              }
            : item
        ));
      } catch (uploadError) {
        uploadCacheRef.current.delete(uploadKey);
        setError(uploadError instanceof Error ? uploadError.message : "Image upload failed");
      } finally {
        URL.revokeObjectURL(previewUrl);
      }
    })();
    uploadTasksRef.current.add(task);
    task.finally(() => uploadTasksRef.current.delete(task));
  };

  const handleRemoveImage = async (index: number) => {
    const row = latestRowsRef.current[index];
    const barcode = normalizeBarcode(row?.barcode);
    if (!row || !barcode || !hasPersistentImage(row)) return;
    if (!window.confirm(`Remove the saved image for Gold barcode ${barcode}?`)) return;

    if (uploadTasksRef.current.size > 0) {
      await Promise.allSettled([...uploadTasksRef.current]);
    }

    setRows((current) => current.map((item) =>
      item.id === row.id ? { ...item, removingImage: true } : item
    ));

    try {
      const response = await fetch("/api/gold/saved-products", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Gold image removal failed");

      setSelectedImage(null);
      setRows((current) => {
        const nextRows = current.map((item) => item.id === row.id
          ? {
              ...item,
              image: "",
              r2Image: "",
              imageUrl: "",
              previewUrl: "",
              fallbackImageUrl: "",
              imageRemoved: true,
              removingImage: false,
            }
          : item
        );
        latestRowsRef.current = nextRows;
        return nextRows;
      });
    } catch (removeError) {
      setRows((current) => current.map((item) =>
        item.id === row.id ? { ...item, removingImage: false } : item
      ));
      setError(removeError instanceof Error ? removeError.message : "Gold image removal failed");
    }
  };

  const validRows = useMemo(
    () => rows.filter((row) => Boolean(normalizeBarcode(row.barcode) && row.data)),
    [rows]
  );

  const rowsWithImages = useMemo(
    () => validRows.filter(hasPersistentImage),
    [validRows]
  );
  const rowsWithoutImages = useMemo(
    () => validRows.filter((row) => !hasPersistentImage(row)),
    [validRows]
  );
  const rowsForExcel = useMemo(() => {
    if (imageFilter === "present") return rowsWithImages;
    if (imageFilter === "missing") return rowsWithoutImages;
    return validRows;
  }, [imageFilter, rowsWithImages, rowsWithoutImages, validRows]);
  const filteredRows = useMemo(() => {
    if (imageFilter === "present") {
      return rows.filter((row) => !row.data || hasPersistentImage(row));
    }
    if (imageFilter === "missing") {
      return rows.filter((row) => !row.data || !hasPersistentImage(row));
    }
    return rows;
  }, [imageFilter, rows]);

  const originalIndex = (displayIndex: number) => {
    const rowId = filteredRows[displayIndex]?.id;
    return rows.findIndex((row) => row.id === rowId);
  };

  const clampDiscountPercent = (value: string) => {
    if (value.trim() === "") return 0;
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(100, Math.max(0, number));
  };

  const totals = useMemo<GoldTotals>(() => validRows.reduce((total, row) => ({
    nw: total.nw + asNumber(row.data?.NW),
    gw: total.gw + asNumber(row.data?.GW),
    stoneWeight: total.stoneWeight + asNumber(row.data?.["ST WT."]),
    diamondWeight: total.diamondWeight + asNumber(row.data?.["DI WT."]),
    totalTag: total.totalTag + asNumber(
      applyDiscount(row.data?.["TOTAL TAG"], priceDiscountPercent)
    ),
    usd: total.usd + asNumber(
      applyDiscount(row.data?.["US$"], usdDiscountPercent)
    ),
  }), { nw: 0, gw: 0, stoneWeight: 0, diamondWeight: 0, totalTag: 0, usd: 0 }), [
    priceDiscountPercent,
    usdDiscountPercent,
    validRows,
  ]);

  const saveAll = async () => {
    if (uploadTasksRef.current.size > 0) {
      await Promise.allSettled([...uploadTasksRef.current]);
    }
    const products = latestRowsRef.current
      .filter((row) => normalizeBarcode(row.barcode) && row.data)
      .map((row) => ({
        barcode: normalizeBarcode(row.barcode),
        data: row.data,
        image: normalizeStoredImageUrl(row.image),
        ...(Object.prototype.hasOwnProperty.call(row, "r2Image")
          ? { r2Image: normalizeStoredImageUrl(row.r2Image) }
          : {}),
      }));
    if (products.length === 0) {
      alert("No Gold products to save");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/gold/saved-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Gold save failed");
      alert(`✅ ${products.length} Gold products saved!`);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Gold save failed";
      setError(message);
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  const downloadExcel = async (mode: "barcode" | "qr") => {
    const { utils, writeFile } = await import("xlsx");
    const values = rowsForExcel.map((row) => mode === "barcode"
      ? normalizeBarcode(row.barcode)
      : row.qrCode || [
          row.data?.BARCODE,
          row.data?.["LOT NO"],
          row.data?.KARAT1,
          row.data?.["STONE NAME"],
          row.data?.NW,
          row.data?.GW,
          row.data?.["ST WT."],
          row.data?.["DI WT."],
          row.data?.["TOTAL TAG"],
          row.data?.["US$"],
        ].map((value) => String(value ?? "").trim()).join(",")
    );
    const header = mode === "barcode" ? "BARCODE" : "qrCode";
    const workbook = utils.book_new();
    utils.book_append_sheet(
      workbook,
      utils.aoa_to_sheet([[header], ...values.map((value) => [value])]),
      "Sheet1"
    );
    const filterName = imageFilter === "all"
      ? "all-products"
      : imageFilter === "present"
        ? "products-with-images"
        : "products-missing-images";
    writeFile(workbook, `gold-${filterName}-${mode === "barcode" ? "barcodes" : "qr-codes"}.xlsx`, { compression: true });
  };

  const removeAllProducts = () => {
    if (!window.confirm("Are you sure you want to remove all Gold products?")) return;
    sessionStorage.removeItem(GOLD_ROWS_STORAGE_KEY);
    const emptyRows = [createEmptyRow()];
    latestRowsRef.current = emptyRows;
    setImageFilter("all");
    setRows(emptyRows);
  };

  return (
    <section className={styles.shell}>
      <div className={styles.modeBanner} aria-label="Gold Jewellery workspace">
        <div className={styles.modeIcon} aria-hidden="true">◆</div>
        <div>
          <span className={styles.modeEyebrow}>GOLD JEWELLERY</span>
          <strong>Gold Inventory Workspace</strong>
          <small>Lot No • Karat • Net Weight • Gold-specific pricing</small>
        </div>
      </div>
      <div className={styles.toolbar}>
        <div>
          <h2>Gold Jewellery Scanner</h2>
          <p className={styles.hint}>Scan Gold QR Code continuously • One product per row</p>
        </div>
        <div className={styles.excelUploads}>
          <div><h3>Barcode Excel</h3><GoldExcelUpload mode="barcode" onImport={handleExcelImport} /></div>
          <div><h3>QR Excel</h3><GoldExcelUpload mode="qr" onImport={handleExcelImport} /></div>
        </div>
      </div>

      <div className={styles.discounts}>
        <label>
          Price Discount (%)
          <input
            type="text"
            inputMode="decimal"
            value={priceDiscountPercent}
            onChange={(event) => setPriceDiscountPercent(
              clampDiscountPercent(event.target.value)
            )}
          />
        </label>
        <label>
          USD Discount (%)
          <input
            type="text"
            inputMode="decimal"
            value={usdDiscountPercent}
            onChange={(event) => setUsdDiscountPercent(
              clampDiscountPercent(event.target.value)
            )}
          />
        </label>
        <button className={styles.actionButton} disabled={rowsForExcel.length === 0} onClick={() => void downloadExcel("barcode")}>Download Barcode Excel</button>
        <button className={styles.actionButton} disabled={rowsForExcel.length === 0} onClick={() => void downloadExcel("qr")}>Download QR Excel</button>
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <GoldProductTable
        rows={filteredRows}
        lastQRRef={lastQRRef}
        lastBarcodeRef={lastBarcodeRef}
        onQRChange={(index, value) => handleQRChange(originalIndex(index), value)}
        onBarcodeChange={(index, value) => handleBarcodeChange(originalIndex(index), value)}
        onBarcodeLookup={(index, value) => handleBarcodeLookup(originalIndex(index), value)}
        onImage={(index, file) => handleImage(originalIndex(index), file)}
        onRemoveImage={(index) => void handleRemoveImage(originalIndex(index))}
        onRemove={(index) => setRows((current) => {
          const indexToRemove = originalIndex(index);
          const next = current.filter((_, currentIndex) => currentIndex !== indexToRemove);
          return next.length > 0 ? next : [createEmptyRow()];
        })}
        onPreview={(primary, fallback) => setSelectedImage({ primary, fallback })}
        totals={totals}
        priceDiscountPercent={priceDiscountPercent}
        usdDiscountPercent={usdDiscountPercent}
      />

      <div className={styles.summary}>
        <strong>Total Products: {validRows.length}</strong>
        <span>Total Tag: {totals.totalTag.toFixed(0)}</span>
        <span>Total US$: {totals.usd.toFixed(2)}</span>
      </div>
      <div className={styles.actions}>
        <button className={`${styles.filterButton} ${imageFilter === "all" ? styles.activeFilter : ""}`} onClick={() => setImageFilter("all")}>All Products ({validRows.length})</button>
        <button className={`${styles.filterButton} ${imageFilter === "present" ? styles.activeFilter : ""}`} onClick={() => setImageFilter("present")}>Images Present ({rowsWithImages.length})</button>
        <button className={`${styles.filterButton} ${imageFilter === "missing" ? styles.activeFilter : ""}`} onClick={() => setImageFilter("missing")}>Images Missing ({rowsWithoutImages.length})</button>
        <button className={styles.saveButton} disabled={saving} onClick={saveAll}>
          {saving ? "Saving…" : "💾 Save All Products"}
        </button>
        <button className={styles.actionButton} onClick={() => setShowPDF(true)}>Download PDF</button>
        <button className={styles.addButton} onClick={() => setRows((current) => [...current, createEmptyRow()])}>+ Add Product</button>
      </div>
      <div className={styles.secondaryActions}>
        <button className={styles.dangerButton} onClick={removeAllProducts}>Remove All Products</button>
      </div>

      <button className={`${styles.scrollButton} ${styles.scrollTop}`} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>↑ Top</button>
      <button className={`${styles.scrollButton} ${styles.scrollBottom}`} onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })}>↓ Bottom</button>

      {showPDF ? (
        <div className={styles.modalBackdrop} role="presentation">
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="gold-pdf-title">
            <h3 id="gold-pdf-title">Download Gold PDF</h3>
            <label>
              Company Name
              <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Enter Company Name" />
            </label>
            <label style={{ marginTop: "12px" }}>
              <input
                type="checkbox"
                checked={uniqueLotNoForPDF}
                onChange={(event) => setUniqueLotNoForPDF(event.target.checked)}
                style={{ width: "auto", marginRight: "7px" }}
              />
              Unique Lot No
            </label>
            <h3>Select Fields</h3>
            {(Object.keys(selectedPDFFields) as GoldPDFField[]).map((field) => (
              <label key={field} style={{ fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={selectedPDFFields[field]}
                  onChange={() => setSelectedPDFFields((current) => ({ ...current, [field]: !current[field] }))}
                  style={{ width: "auto", marginRight: "7px" }}
                />
                {field}
              </label>
            ))}
            <h3>PDF Layout</h3>
            {([
              ["version1", "Version 1 – Table Layout"],
              ["version2", "Version 2 – Catalogue Layout"],
              ["version3", "Version 3 – Large Product Cards"],
              ["version4", "Version 4 – Dynamic Image Grid"],
              ["version5", "Version 5 – Unique Lot Quantity Grid"],
            ] as Array<[GoldPDFVersion, string]>).map(([version, label]) => (
              <label key={version} style={{ fontWeight: 400 }}>
                <input
                  type="radio"
                  name="gold-pdf-layout"
                  checked={pdfVersion === version}
                  onChange={() => { setPDFVersion(version); setPDFGridError(""); }}
                  style={{ width: "auto", marginRight: "7px" }}
                />
                {label}
              </label>
            ))}
            {(pdfVersion === "version4" || pdfVersion === "version5") ? (
              <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
                <label style={{ flex: 1 }}>Rows<input type="number" min="1" max="10" value={pdfGridRows} onChange={(event) => { setPDFGridRows(event.target.value); setPDFGridError(""); }} /></label>
                <label style={{ flex: 1 }}>Columns<input type="number" min="1" max="10" value={pdfGridColumns} onChange={(event) => { setPDFGridColumns(event.target.value); setPDFGridError(""); }} /></label>
              </div>
            ) : null}
            {pdfGridError ? <p className={styles.error}>{pdfGridError}</p> : null}
            <p>PDF Products: {filteredRows.filter((row) => row.data).length}</p>
            {isGeneratingPDF ? <p>Generating PDF… {pdfProgress}%</p> : null}
            <div className={styles.modalActions}>
              <button
                className={styles.saveButton}
                disabled={isGeneratingPDF || filteredRows.every((row) => !row.data)}
                onClick={async () => {
                  const gridRows = Number(pdfGridRows);
                  const gridColumns = Number(pdfGridColumns);
                  if (
                    (pdfVersion === "version4" || pdfVersion === "version5") &&
                    (!Number.isInteger(gridRows) || !Number.isInteger(gridColumns) ||
                      gridRows < 1 || gridColumns < 1 || gridRows > 10 || gridColumns > 10)
                  ) {
                    setPDFGridError("Rows and Columns must be whole numbers from 1 to 10.");
                    return;
                  }
                  setIsGeneratingPDF(true);
                  setPDFProgress(0);
                  try {
                    const { generateGoldPDF } = await import("@/utils/generateGoldPDF");
                    await generateGoldPDF(
                      filteredRows.filter((row) => row.data),
                      {
                        version: pdfVersion,
                        selectedFields: selectedPDFFields,
                        companyName,
                        priceDiscountPercent,
                        usdDiscountPercent,
                        uniqueLotNo: uniqueLotNoForPDF,
                        grid: { rows: gridRows, columns: gridColumns },
                      },
                      setPDFProgress
                    );
                    setShowPDF(false);
                  } catch (pdfError) {
                    console.error("Gold PDF generation failed:", pdfError);
                    setError("Gold PDF generation failed");
                  } finally {
                    setIsGeneratingPDF(false);
                    setPDFProgress(0);
                  }
                }}
              >Generate PDF</button>
              <button className={styles.filterButton} disabled={isGeneratingPDF} onClick={() => setShowPDF(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedImage ? (
        <dialog className={styles.imageDialog} open onClick={() => setSelectedImage(null)}>
          <ProviderAwareImage
            className={styles.largeImage}
            primaryUrl={selectedImage.primary}
            fallbackUrl={selectedImage.fallback}
            alt="Selected Gold product"
          />
        </dialog>
      ) : null}
    </section>
  );
}
