"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import SearchFilters from "./SearchFilters";
import SearchPagination from "./SearchPagination";
import SearchResults from "./SearchResults";
import {
  initialSearchFilters,
  type SearchFiltersState,
  type SearchProduct,
} from "./types";
import { resolveProductImage } from "@/utils/resolveProductImage";
import styles from "./CustomSearch.module.css";

type SearchResponse = {
  products: SearchProduct[];
  total: number;
  page: number;
  pageSize: number;
};

const createEmptyScannerRow = () => ({
  qrCode: "",
  barcode: "",
  imageUrl: "",
  previewUrl: "",
  data: null,
});

const toScannerRow = (product: SearchProduct, products: SearchProduct[]) => {
  const image = resolveProductImage(product, products);

  return {
    qrCode: "",
    barcode: String(product.barcode || product.data?.BARCODE || "").trim(),
    imageUrl: image,
    previewUrl: image,
    data: product.data || null,
  };
};

export default function CustomSearch() {
  const router = useRouter();
  const [filters, setFilters] =
    useState<SearchFiltersState>(initialSearchFilters);
  const [products, setProducts] = useState<SearchProduct[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState("");
  const [uniqueItemNo, setUniqueItemNo] = useState(false);

  const runSearch = useCallback(
    async (targetPage: number, targetPageSize: number) => {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams();

        Object.entries(filters).forEach(([key, value]) => {
          if (value.trim()) params.set(key, value.trim());
        });

        params.set("page", String(targetPage));
        params.set("pageSize", String(targetPageSize));

        const response = await fetch(`/api/custom-search?${params.toString()}`);
        const data: SearchResponse & { error?: string } = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Unable to search products");
        }

        setProducts(data.products);
        setTotal(data.total);
        setPage(data.page);
        setPageSize(data.pageSize);
        setHasSearched(true);
      } catch (searchError) {
        setError(
          searchError instanceof Error
            ? searchError.message
            : "Unable to search products"
        );
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  const updateFilter = (field: keyof SearchFiltersState, value: string) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const clearFilters = () => {
    setFilters(initialSearchFilters);
    setProducts([]);
    setSelectedIds(new Set());
    setTotal(0);
    setPage(1);
    setHasSearched(false);
    setError("");
  };

  const selectProduct = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectCurrentPage = (checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      products.forEach((product) => {
        if (checked) next.add(product._id);
        else next.delete(product._id);
      });
      return next;
    });
  };

  const addToScanner = (productsToAdd: SearchProduct[]) => {
    if (productsToAdd.length === 0) {
      setError("Select at least one product to add to Scanner.");
      return;
    }

    let storedRows: any[] = [];

    try {
      const storedValue = sessionStorage.getItem("scannerRows");
      const parsedRows = storedValue ? JSON.parse(storedValue) : [];
      storedRows = Array.isArray(parsedRows) ? parsedRows : [];
    } catch {
      storedRows = [];
    }

    const existingRows = storedRows.filter(
      (row) => row && (row.barcode || row.qrCode || row.data)
    );
    const knownBarcodes = new Set(
      existingRows.map((row) => String(row.barcode || "").trim()).filter(Boolean)
    );
    // const newRows = productsToAdd
    //   .map(toScannerRow)
    //   .filter((row) => row.barcode && !knownBarcodes.has(row.barcode));

    let productsForScanner = productsToAdd;

    if (uniqueItemNo) {
      const seenItemNos = new Set<string>();

      productsForScanner = productsToAdd.filter((product) => {
        const itemNo = String(
          product.data?.ITEMNO || ""
        ).trim();

        if (!itemNo) return true;

        if (seenItemNos.has(itemNo)) {
          return false;
        }

        seenItemNos.add(itemNo);
        return true;
      });
    }

    const newRows = productsForScanner
      .map((product) => toScannerRow(product, products))
      .filter(
        (row) =>
          row.barcode &&
          !knownBarcodes.has(row.barcode)
      );

    sessionStorage.setItem(
      "scannerRows",
      JSON.stringify([...existingRows, ...newRows, createEmptyScannerRow()])
    );
    // router.push("/");
    window.location.href = "/scanner";
  };

  const selectedProducts = products.filter((product) =>
    selectedIds.has(product._id)
  );

  return (
    <>
      <SearchFilters
        filters={filters}
        loading={loading}
        onChange={updateFilter}
        onClear={clearFilters}
        onSearch={() => runSearch(1, pageSize)}
      />

      <section className={styles.resultsPanel}>
        <div className={styles.resultsHeader}>
          <div>
            <h2>Search Results</h2>
            <p>
              Products Found: <strong>{hasSearched ? total : 0}</strong>
              <span aria-hidden="true"> | </span>
              Selected: <strong>{selectedIds.size}</strong>
            </p>
          </div>

          <div className={styles.resultActions}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginRight: "12px",
              }}
            >
              <input
                type="checkbox"
                checked={uniqueItemNo}
                onChange={(e) => setUniqueItemNo(e.target.checked)}
              />
              Unique Item No
            </label>
            <button
              className={styles.primaryButton}
              disabled={selectedProducts.length === 0}
              onClick={() => addToScanner(selectedProducts)}
            >
              Add Selected To Scanner
            </button>
            {/* <button
              className={styles.secondaryButton}
              disabled={products.length === 0}
              onClick={() => addToScanner(products)}
            >
              Add All To Scanner
            </button> */}
            <button
              className={styles.secondaryButton}
              disabled={products.length === 0}
              onClick={async () => {
                try {
                  const params = new URLSearchParams();

                  Object.entries(filters).forEach(([key, value]) => {
                    if (value.trim()) {
                      params.set(key, value.trim());
                    }
                  });

                  params.set("page", "1");
                  params.set("pageSize", "10000");

                  const response = await fetch(
                    `/api/custom-search?${params.toString()}`
                  );

                  const data = await response.json();
                  console.log("TOTAL:", data.total);
                  console.log("PRODUCTS LENGTH:", data.products?.length);
                  console.log(data);

                  addToScanner(data.products || []);
                } catch (err) {
                  console.error(err);
                  alert("Failed to load all products");
                }
              }}
            >
              Add All To Scanner
            </button>
          </div>
        </div>

        {error ? <div className={styles.errorBox}>{error}</div> : null}

        <SearchResults
          products={products}
          selectedIds={selectedIds}
          onSelect={selectProduct}
          onSelectPage={selectCurrentPage}
        />

        <SearchPagination
          page={page}
          pageSize={pageSize}
          total={total}
          loading={loading}
          onPageChange={(nextPage) => runSearch(nextPage, pageSize)}
          onPageSizeChange={(nextPageSize) => runSearch(1, nextPageSize)}
        />
      </section>
    </>
  );
}
