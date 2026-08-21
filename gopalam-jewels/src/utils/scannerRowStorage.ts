const SCANNER_ROWS_STORAGE_KEY = "scannerRows";

const compactScannerRow = (row: any) => {
  const cleanRow = { ...(row || {}) };
  delete cleanRow.__originalIndex;
  delete cleanRow.__barcodeExcelImportId;
  delete cleanRow.__qrExcelImportId;
  const imageUrl = String(cleanRow.imageUrl || "");
  const previewUrl = String(cleanRow.previewUrl || "");

  if (!previewUrl || previewUrl === imageUrl) {
    delete cleanRow.previewUrl;
  }

  return cleanRow;
};

export const readScannerRows = () => {
  try {
    const storedRows = sessionStorage.getItem(SCANNER_ROWS_STORAGE_KEY);
    const parsedRows = storedRows ? JSON.parse(storedRows) : [];
    if (!Array.isArray(parsedRows)) return [];

    return parsedRows.map((row) => ({
      ...row,
      imageUrl: String(row?.imageUrl || ""),
      previewUrl: String(row?.previewUrl || row?.imageUrl || ""),
    }));
  } catch (error) {
    console.error("Unable to read Scanner rows:", error);
    return [];
  }
};

export const writeScannerRows = (rows: any[]) => {
  try {
    sessionStorage.setItem(
      SCANNER_ROWS_STORAGE_KEY,
      JSON.stringify(rows.map(compactScannerRow))
    );
    return true;
  } catch (error) {
    console.error("Unable to store Scanner rows:", error);
    return false;
  }
};

export const clearScannerRows = () => {
  sessionStorage.removeItem(SCANNER_ROWS_STORAGE_KEY);
};
