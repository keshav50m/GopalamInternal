"use client";

import type { SearchFiltersState } from "./types";
import styles from "./CustomSearch.module.css";

type Props = {
  filters: SearchFiltersState;
  loading: boolean;
  onChange: (field: keyof SearchFiltersState, value: string) => void;
  onClear: () => void;
  onSearch: () => void;
};

const textFields: Array<{
  key: keyof SearchFiltersState;
  label: string;
  placeholder: string;
}> = [
  { key: "barcode", label: "Barcode", placeholder: "Contains barcode" },
  { key: "itemNo", label: "Item No", placeholder: "Contains item number" },
  { key: "stone", label: "Stone", placeholder: "Example: TOPAZ" },
  { key: "size", label: "Size", placeholder: "Example: OCT" },
];

const numericFields: Array<{
  label: string;
  minKey: keyof SearchFiltersState;
  maxKey: keyof SearchFiltersState;
}> = [
  { label: "Gross", minKey: "grossMin", maxKey: "grossMax" },
  { label: "StoneWt", minKey: "stoneWtMin", maxKey: "stoneWtMax" },
  { label: "DAI", minKey: "daiMin", maxKey: "daiMax" },
  { label: "Price", minKey: "priceMin", maxKey: "priceMax" },
  { label: "USD", minKey: "usdMin", maxKey: "usdMax" },
];

export default function SearchFilters({
  filters,
  loading,
  onChange,
  onClear,
  onSearch,
}: Props) {
  return (
    <section className={styles.filterPanel}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Product Filters</h2>
          <p>Combine any text and numeric fields to narrow the catalogue.</p>
        </div>
      </div>

      <div className={styles.textFilterGrid}>
        {textFields.map((field) => (
          <label className={styles.field} key={field.key}>
            <span>{field.label}</span>
            <input
              type="text"
              value={filters[field.key]}
              placeholder={field.placeholder}
              onChange={(event) => onChange(field.key, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSearch();
              }}
            />
          </label>
        ))}
      </div>

      <div className={styles.rangeGrid}>
        {numericFields.map((field) => (
          <fieldset className={styles.rangeField} key={field.label}>
            <legend>{field.label}</legend>
            <input
              type="number"
              inputMode="decimal"
              value={filters[field.minKey]}
              placeholder="Min Value"
              onChange={(event) => onChange(field.minKey, event.target.value)}
            />
            <span>to</span>
            <input
              type="number"
              inputMode="decimal"
              value={filters[field.maxKey]}
              placeholder="Max Value"
              onChange={(event) => onChange(field.maxKey, event.target.value)}
            />
          </fieldset>
        ))}
      </div>

      <div className={styles.filterActions}>
        <button className={styles.primaryButton} disabled={loading} onClick={onSearch}>
          {loading ? "Searching..." : "Search"}
        </button>
        <button className={styles.secondaryButton} disabled={loading} onClick={onClear}>
          Clear Filters
        </button>
      </div>
    </section>
  );
}
