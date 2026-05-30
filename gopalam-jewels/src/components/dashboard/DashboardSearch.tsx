"use client";

import { useMemo, useState } from "react";
import type { SavedProduct } from "./types";
import { formatDisplayDate, getBarcode, getStoneName } from "./dashboardUtils";
import styles from "./Dashboard.module.css";

type Props = {
  products: SavedProduct[];
};

export default function DashboardSearch({ products }: Props) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];

    return products
      .filter((product) => getBarcode(product).toLowerCase().includes(normalizedQuery))
      .slice(0, 10);
  }, [products, query]);

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

      {query.trim() && results.length === 0 ? (
        <div className={styles.emptyState}>No matching barcode found</div>
      ) : null}

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
