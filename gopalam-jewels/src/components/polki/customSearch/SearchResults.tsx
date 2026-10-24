"use client";

import type { SearchProduct } from "./types";
import styles from "./CustomSearch.module.css";
import {
  buildCloudinaryDeliveryUrl,
  CLOUDINARY_THUMBNAIL_TRANSFORMATION,
} from "@/utils/cloudinaryDelivery";
import ProviderAwareImage from "@/components/ProviderAwareImage";
import { resolveProductImageCandidates } from "@/utils/polki/resolveProductImage";

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
            <th>Item</th>
            <th>Lot</th>
            <th>Gross</th>
            <th>Net Wt.</th>
            <th>Puwai</th>
            <th>Labour per gram</th><th>Labour + Puwai</th>
            <th>Final</th>
            <th>SILVER</th>
            <th>Tag</th>
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
              const image = resolveProductImageCandidates(product, products);
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
                    {image.primaryUrl ? (
                      <ProviderAwareImage
                        className={styles.productImage}
                        primaryUrl={buildCloudinaryDeliveryUrl(
                          image.primaryUrl,
                          CLOUDINARY_THUMBNAIL_TRANSFORMATION
                        )}
                        fallbackUrl={buildCloudinaryDeliveryUrl(
                          image.fallbackUrl,
                          CLOUDINARY_THUMBNAIL_TRANSFORMATION
                        )}
                        loading="lazy"
                        decoding="async"
                        alt={`Product ${displayValue(product.barcode)}`}
                      />
                    ) : (
                      <span className={styles.noImage}>No image</span>
                    )}
                  </td>
                  <td className={styles.qrColumn}></td>
                  <td>{displayValue(product.barcode || data.BARCODE)}</td>
                  <td>{displayValue(data.ITEM)}</td>
                  <td>{displayValue(data["LOT NO."])}</td>
                  <td>{displayValue(data["GROSSWT."])}</td>
                  <td>{displayValue(data["NET WT."])}</td>
                  <td>{displayValue(data["PUWAI"])}</td>
                  <td>{displayValue(data["LABOUR PER GRM"])}</td><td>{displayValue(data["LABOUR + PUWAI"])}</td>
                  <td>{displayValue(data["FINAL"])}</td>
                  <td>{displayValue(data.SILVER)}</td>
                  <td>{displayValue(data.TAG)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
