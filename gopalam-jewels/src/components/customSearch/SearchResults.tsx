"use client";

import type { SearchProduct } from "./types";
import styles from "./CustomSearch.module.css";

type Props = {
  products: SearchProduct[];
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  onSelectPage: (checked: boolean) => void;
};

const displayValue = (value: unknown) =>
  value === null || value === undefined || value === "" ? "" : String(value);

export default function SearchResults({
  products,
  selectedIds,
  onSelect,
  onSelectPage,
}: Props) {
  const pageIsSelected =
    products.length > 0 && products.every((product) => selectedIds.has(product._id));

  return (
    <div className={styles.tableWrap}>
      <table className={styles.resultsTable}>
        <thead>
          <tr>
            <th className={styles.checkboxColumn}>
              <input
                type="checkbox"
                aria-label="Select all products on this page"
                checked={pageIsSelected}
                onChange={(event) => onSelectPage(event.target.checked)}
              />
            </th>
            <th>Image</th>
            <th>QR Code</th>
            <th>Barcode</th>
            <th>Item No</th>
            <th>Stone</th>
            <th>Gross</th>
            <th>StoneWt</th>
            <th>DAI</th>
            <th>Price</th>
            <th>USD</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          {products.length === 0 ? (
            <tr>
              <td className={styles.emptyState} colSpan={12}>
                No products found for the current filters.
              </td>
            </tr>
          ) : (
            products.map((product) => {
              const image = product.imageCatalogueImage || product.image || "";
              const data = product.data || {};

              return (
                <tr key={product._id}>
                  <td className={styles.checkboxColumn}>
                    <input
                      type="checkbox"
                      aria-label={`Select barcode ${product.barcode}`}
                      checked={selectedIds.has(product._id)}
                      onChange={(event) =>
                        onSelect(product._id, event.target.checked)
                      }
                    />
                  </td>
                  <td>
                    {image ? (
                      <img
                        className={styles.productImage}
                        src={image}
                        alt={`Product ${displayValue(product.barcode)}`}
                      />
                    ) : (
                      <span className={styles.noImage}>No image</span>
                    )}
                  </td>
                  <td className={styles.qrColumn}></td>
                  <td>{displayValue(product.barcode || data.BARCODE)}</td>
                  <td>{displayValue(data.ITEMNO)}</td>
                  <td>{displayValue(data["STONE NAME"])}</td>
                  <td>{displayValue(data["GROSS WT"])}</td>
                  <td>{displayValue(data["STONE WT"])}</td>
                  <td>{displayValue(data["DAI WT"])}</td>
                  <td>{displayValue(data["TAG PRICE"])}</td>
                  <td>{displayValue(data.USD)}</td>
                  <td>{displayValue(data.SIZE)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
