"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProviderAwareImage from "@/components/ProviderAwareImage";
import {
  CASTING_CATALOGUE_FIELDS,
  CASTING_CATALOGUE_FIELD_LABELS,
  DEFAULT_CASTING_CATALOGUE_FIELDS,
  type CastingCatalogueFieldSettings,
} from "@/lib/castingCatalogue";
import styles from "./InteractiveCatalogue.module.css";

type Product = {
  barcode: string;
  itemNo: string;
  stone: string;
  primaryImageUrl: string;
  fallbackImageUrl: string;
};

type PreviousCatalogue = {
  token: string;
  title: string;
  productCount: number;
  createdAt: string;
  active: boolean;
};

const PAGE_SIZE = 50;

export default function InteractiveCatalogueAdmin() {
  const [barcode, setBarcode] = useState("");
  const [itemNo, setItemNo] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({ barcode: "", itemNo: "" });
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visibleFields, setVisibleFields] = useState<CastingCatalogueFieldSettings>({ ...DEFAULT_CASTING_CATALOGUE_FIELDS });
  const [title, setTitle] = useState("");
  const [catalogues, setCatalogues] = useState<PreviousCatalogue[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (appliedFilters.barcode) params.set("barcode", appliedFilters.barcode);
      if (appliedFilters.itemNo) params.set("itemNo", appliedFilters.itemNo);
      const response = await fetch(`/api/casting-catalogues/products?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load products");
      setProducts(data.products);
      setTotal(data.total);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load products");
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, page]);

  const loadCatalogues = useCallback(async () => {
    try {
      const response = await fetch("/api/casting-catalogues?pageSize=20");
      const data = await response.json();
      if (response.ok) setCatalogues(data.catalogues);
    } catch {
      // Product selection remains usable if history cannot be loaded.
    }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);
  useEffect(() => { loadCatalogues(); }, [loadCatalogues]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allPageSelected = products.length > 0 && products.every((product) => selected.has(product.barcode));
  const absoluteUrl = (token: string) => typeof window === "undefined" ? `/catalogue/${token}` : `${window.location.origin}/catalogue/${token}`;
  const copyLink = async (url: string) => navigator.clipboard.writeText(url);

  const toggleProduct = (productBarcode: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(productBarcode)) next.delete(productBarcode);
      else next.add(productBarcode);
      return next;
    });
  };

  const togglePage = () => {
    setSelected((current) => {
      const next = new Set(current);
      products.forEach((product) => allPageSelected ? next.delete(product.barcode) : next.add(product.barcode));
      return next;
    });
  };

  const createCatalogue = async () => {
    setError("");
    setCreatedUrl("");
    setCreating(true);
    try {
      const response = await fetch("/api/casting-catalogues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, productBarcodes: [...selected], visibleFields }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create catalogue");
      const url = absoluteUrl(data.token);
      setCreatedUrl(url);
      setSelected(new Set());
      setTitle("");
      await loadCatalogues();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create catalogue");
    } finally {
      setCreating(false);
    }
  };

  const selectedCount = selected.size;
  const hasVisibleField = useMemo(
    () => CASTING_CATALOGUE_FIELDS.some((field) => visibleFields[field]),
    [visibleFields]
  );

  return (
    <div className={styles.adminGrid}>
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div><h2>Select Casting products</h2><p>Selections are retained while you search and move between pages.</p></div>
          <strong>{selectedCount} selected</strong>
        </div>
        <form className={styles.searchForm} onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setAppliedFilters({ barcode: barcode.trim(), itemNo: itemNo.trim() });
        }}>
          <label>Barcode<input value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Search barcode" /></label>
          <label>Item No.<input value={itemNo} onChange={(event) => setItemNo(event.target.value)} placeholder="Search item number" /></label>
          <button type="submit" className={styles.primaryButton}>Search</button>
          <button type="button" className={styles.secondaryButton} onClick={() => {
            setBarcode(""); setItemNo(""); setPage(1); setAppliedFilters({ barcode: "", itemNo: "" });
          }}>Clear</button>
        </form>
        {error ? <div className={styles.error}>{error}</div> : null}
        <div className={styles.tableWrap}>
          <table className={styles.productTable}>
            <thead><tr><th><input type="checkbox" aria-label="Select this page" checked={allPageSelected} onChange={togglePage} /></th><th>Image</th><th>Barcode</th><th>Item No.</th><th>Stone</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5}>Loading products…</td></tr> : products.map((product) => (
                <tr key={product.barcode}>
                  <td><input type="checkbox" checked={selected.has(product.barcode)} onChange={() => toggleProduct(product.barcode)} aria-label={`Select ${product.barcode}`} /></td>
                  <td>{product.primaryImageUrl ? <ProviderAwareImage loading="lazy" className={styles.thumb} primaryUrl={product.primaryImageUrl} fallbackUrl={product.fallbackImageUrl} alt={product.itemNo || product.barcode} /> : <span className={styles.noImage}>No image</span>}</td>
                  <td>{product.barcode}</td><td>{product.itemNo || "—"}</td><td>{product.stone || "—"}</td>
                </tr>
              ))}
              {!loading && products.length === 0 ? <tr><td colSpan={5}>No products found.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className={styles.pagination}><span>Page {page} of {pageCount} · {total} products</span><div><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button><button disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
      </section>

      <aside className={styles.sideColumn}>
        <section className={styles.panel}>
          <h2>Create shareable link</h2>
          <label className={styles.titleField}>Catalogue title (optional)<input maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <fieldset className={styles.fields}><legend>Customer-visible fields</legend>{CASTING_CATALOGUE_FIELDS.map((field) => <label key={field}><input type="checkbox" checked={visibleFields[field]} onChange={() => setVisibleFields((current) => ({ ...current, [field]: !current[field] }))} />{CASTING_CATALOGUE_FIELD_LABELS[field]}</label>)}</fieldset>
          <button className={styles.primaryButton} disabled={!selectedCount || !hasVisibleField || creating} onClick={createCatalogue}>{creating ? "Generating…" : "Generate Catalogue Link"}</button>
          {createdUrl ? <div className={styles.success}><span>Catalogue created</span><a href={createdUrl} target="_blank" rel="noreferrer">{createdUrl}</a><button onClick={() => copyLink(createdUrl)}>Copy Link</button></div> : null}
        </section>
        <section className={styles.panel}>
          <h2>Previously generated</h2>
          <div className={styles.history}>{catalogues.map((catalogue) => {
            const url = absoluteUrl(catalogue.token);
            return <article key={catalogue.token}><div><strong>{catalogue.title || "Untitled catalogue"}</strong><span>{catalogue.productCount} products · {new Date(catalogue.createdAt).toLocaleDateString()}</span></div><div><a href={url} target="_blank" rel="noreferrer">Open</a><button onClick={() => copyLink(url)}>Copy Link</button></div></article>;
          })}{catalogues.length === 0 ? <p>No catalogues generated yet.</p> : null}</div>
        </section>
      </aside>
    </div>
  );
}
