"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ProviderAwareImage from "@/components/ProviderAwareImage";
import { goldRangeFilters, goldTextFilters } from "@/lib/goldSearch";
import { GOLD_PRODUCT_FIELDS, normalizeGoldProductData } from "@/utils/goldProductData";
import styles from "@/components/customSearch/CustomSearch.module.css";

type Product = {
  _id: string; barcode: string; data: Record<string, string>; sold: boolean; imageRemoved: boolean;
  image: string; r2Image: string; resolvedImageUrl: string; fallbackImageUrl: string;
};
type Response = { products: Product[]; nextCursor: string | null; error?: string };

export default function GoldCustomSearch() {
  const router = useRouter();
  const [filters, setFilters] = useState<Record<string, string>>({ status: "all" });
  const [pageSize, setPageSize] = useState("25");
  const [applied, setApplied] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<string[]>([""]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [uniqueLot, setUniqueLot] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const update = (key: string, value: string) => setFilters(current => ({ ...current, [key]: value }));

  async function search(params: string, pages: string[]) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams(params);
      const cursor = pages[pages.length - 1];
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/gold/custom-search?${query}`, { signal: controller.signal });
      const data: Response = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to search Gold products.");
      if (controller.signal.aborted) return;
      setProducts(data.products); setNextCursor(data.nextCursor); setHistory(pages);
      setApplied(params); setSelected(new Set()); setSearched(true);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Search failed.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  function clear() {
    active.current?.abort(); setLoading(false); setFilters({ status: "all" }); setProducts([]);
    setSelected(new Set()); setHistory([""]); setNextCursor(null); setApplied(""); setSearched(false); setError("");
  }
  function toggle(id: string) {
    setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function addToScanner(items: Product[]) {
    try {
      const parsed: unknown = JSON.parse(sessionStorage.getItem("goldScannerRows") || "[]");
      if (!Array.isArray(parsed)) throw new Error("Stored Gold scanner rows could not be read.");
      const existing = parsed.filter(row => row && (row.barcode || row.qrCode || row.data));
      const knownBarcodes = new Set(existing.map(row => String(row.barcode || row.data?.BARCODE || "").trim()).filter(Boolean));
      const lots = new Set(existing.map(row => String(row.data?.["LOT NO"] || "").trim().toUpperCase()).filter(Boolean));
      const additions = items.filter(item => {
        const lot = String(item.data["LOT NO"] || "").trim().toUpperCase();
        if (!item.barcode || knownBarcodes.has(item.barcode) || (uniqueLot && lot && lots.has(lot))) return false;
        knownBarcodes.add(item.barcode); if (lot) lots.add(lot); return true;
      }).map(item => ({
        id: crypto.randomUUID(), qrCode: "", barcode: item.barcode, data: normalizeGoldProductData(item.data),
        image: item.image, r2Image: item.r2Image, imageUrl: item.resolvedImageUrl, previewUrl: item.resolvedImageUrl,
        fallbackImageUrl: item.fallbackImageUrl, imageRemoved: item.imageRemoved, removingImage: false,
      }));
      // One-time handoff also works when the initial browser navigation was a reload.
      sessionStorage.setItem("goldSearchSelection", JSON.stringify([...existing, ...additions]));
      router.push("/gold/scanner");
    } catch (err) { setError(err instanceof Error && err.message.includes("could not be read") ? err.message : "Unable to store these products in this browser. Try a smaller selection."); }
  }
  return <>
    <form className={styles.filterPanel} onSubmit={event => {
      event.preventDefault(); const params = new URLSearchParams(filters); params.set("pageSize", pageSize); void search(params.toString(), [""]);
    }}>
      <div className={styles.sectionHeading}><div><h2>Search Gold Inventory</h2><p>Combine filters to narrow your results. Weight and price ranges are inclusive.</p></div></div>
      <div className={styles.textFilterGrid}>
        {goldTextFilters.map(([key, label]) => <label className={styles.field} key={key}><span>{label}</span><input value={filters[key] || ""} maxLength={100} onChange={event => update(key, event.target.value)} /></label>)}
        <label className={styles.field}><span>Inventory Status</span><select value={filters.status} onChange={event => update("status", event.target.value)}><option value="all">All products</option><option value="available">Available</option><option value="sold">Sold</option></select></label>
        <label className={styles.field}><span>Products per page</span><select value={pageSize} onChange={event => setPageSize(event.target.value)}>{[25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      </div>
      <div className={styles.rangeGrid}>{goldRangeFilters.map(([key, , label]) => <fieldset className={styles.rangeField} key={key}><legend>{label}</legend>
        <input type="number" min="0" step="any" aria-label={`${label} minimum`} placeholder="Min" value={filters[`${key}Min`] || ""} onChange={event => update(`${key}Min`, event.target.value)} /><span>to</span>
        <input type="number" min="0" step="any" aria-label={`${label} maximum`} placeholder="Max" value={filters[`${key}Max`] || ""} onChange={event => update(`${key}Max`, event.target.value)} />
      </fieldset>)}</div>
      <div className={styles.filterActions}><button className={styles.primaryButton} disabled={loading}>{loading ? "Searching…" : "Search Gold"}</button><button type="button" className={styles.secondaryButton} onClick={clear}>Clear Filters</button></div>
    </form>
    <section className={styles.resultsPanel} aria-busy={loading}>
      <div className={styles.resultsHeader}><div><h2>Search Results</h2><p>{searched ? `${products.length} products on this page · Page ${history.length} · ${selected.size} selected` : "Choose filters and search to view Gold products."}</p></div>
        <div className={styles.resultActions} style={{ flexWrap: "wrap" }}>
          <label><input type="checkbox" checked={uniqueLot} onChange={event => setUniqueLot(event.target.checked)} /> Unique Lot No</label>
          <button className={styles.primaryButton} disabled={loading || !selected.size} onClick={() => addToScanner(products.filter(item => selected.has(item._id)))}>Add Selected To Gold Scanner</button>
          <button className={styles.secondaryButton} disabled={loading || !products.length} onClick={() => addToScanner(products)}>Add This Page To Gold Scanner</button>
        </div>
      </div>
      {error && <p role="alert" className={styles.errorBox}>{error}</p>}
      {loading && <p role="status">Loading Gold products…</p>}
      <div style={{ overflowX: "auto" }}><table className={styles.resultsTable}>
        <thead><tr><th><input type="checkbox" aria-label="Select all products on this page" disabled={loading || !products.length} checked={products.length > 0 && products.every(item => selected.has(item._id))} onChange={event => setSelected(event.target.checked ? new Set(products.map(item => item._id)) : new Set())} /></th><th>Image</th>{GOLD_PRODUCT_FIELDS.map(field => <th key={field}>{field}</th>)}<th>Status</th></tr></thead>
        <tbody>{products.map(item => <tr key={item._id}>
          <td><input type="checkbox" aria-label={`Select barcode ${item.barcode}`} checked={selected.has(item._id)} disabled={loading} onChange={() => toggle(item._id)} /></td>
          <td>{item.resolvedImageUrl ? <a href={item.resolvedImageUrl} target="_blank" rel="noreferrer"><ProviderAwareImage className={styles.productImage} primaryUrl={item.resolvedImageUrl} fallbackUrl={item.fallbackImageUrl} alt={`Gold ${item.barcode}`} loading="lazy" /></a> : <span className={styles.noImage}>No image</span>}</td>
          {GOLD_PRODUCT_FIELDS.map(field => <td key={field}>{(field === "BARCODE" ? item.barcode : item.data[field]) || "—"}</td>)}<td>{item.sold ? "Sold" : "Available"}</td>
        </tr>)}{searched && !products.length && !loading && <tr><td colSpan={13} className={styles.emptyState}>No Gold products match these filters.</td></tr>}</tbody>
      </table></div>
      {searched && <div className={styles.pagination}><p>Showing bounded pages of matching products.</p><div className={styles.pageControls}>
        <button className={styles.secondaryButton} disabled={loading || history.length <= 1} onClick={() => void search(applied, history.slice(0, -1))}>Previous</button>
        <span>Page {history.length}</span><button className={styles.primaryButton} disabled={loading || !nextCursor} onClick={() => { if (nextCursor) void search(applied, [...history, nextCursor]); }}>Next</button>
      </div></div>}
    </section>
  </>;
}
