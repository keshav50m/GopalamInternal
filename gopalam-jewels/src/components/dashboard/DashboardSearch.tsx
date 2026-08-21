"use client";

import { useEffect, useState } from "react";
import type { SavedProduct } from "./types";
import { formatDisplayDate, getBarcode, getStoneName } from "./dashboardUtils";
import styles from "./Dashboard.module.css";

export default function DashboardSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SavedProduct[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/dashboard?barcode=${encodeURIComponent(normalizedQuery)}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        if (response.ok) {
          setResults(Array.isArray(data.products) ? data.products : []);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2>Product Search by Barcode</h2>
      </div>

      <input
        className={styles.searchInput}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search barcode"
      />

      {query.trim() && !loading && results.length === 0 ? (
        <div className={styles.emptyState}>No matching barcode found</div>
      ) : null}

      {loading ? <div className={styles.emptyState}>Searching...</div> : null}

      {results.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.dashboardTable}>
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Item No</th>
                <th>Stone</th>
                <th>Image</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {results.map((product, index) => (
                <tr key={`${getBarcode(product)}-${index}`}>
                  <td>{getBarcode(product)}</td>
                  <td>{product.data?.ITEMNO || "Not available"}</td>
                  <td>{getStoneName(product)}</td>
                  <td>{product.image ? "Available" : "Missing"}</td>
                  <td>{formatDisplayDate(product)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
