"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProviderAwareImage from "@/components/ProviderAwareImage";
import { CASTING_CATALOGUE_FIELDS, CASTING_CATALOGUE_FIELD_LABELS, DEFAULT_CASTING_CATALOGUE_FIELDS, type CastingCatalogueFieldSettings } from "@/lib/castingCatalogue";
import CatalogueProductImporter, { type ImportedCatalogueProduct } from "./CatalogueProductImporter";
import styles from "./InteractiveCatalogue.module.css";

type PreviousCatalogue = { token: string; title: string; productCount: number; createdAt: string; active: boolean };

export default function InteractiveCatalogueAdmin() {
  const [selected, setSelected] = useState<Map<string, ImportedCatalogueProduct>>(new Map());
  const [visibleFields, setVisibleFields] = useState<CastingCatalogueFieldSettings>({ ...DEFAULT_CASTING_CATALOGUE_FIELDS });
  const [title, setTitle] = useState("");
  const [priceDiscountPercent, setPriceDiscountPercent] = useState(0);
  const [usdDiscountPercent, setUsdDiscountPercent] = useState(0);
  const [catalogues, setCatalogues] = useState<PreviousCatalogue[]>([]);
  const [creating, setCreating] = useState(false);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");
  const [deletingToken, setDeletingToken] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyNotice, setHistoryNotice] = useState("");

  const loadCatalogues = useCallback(async () => {
    try {
      const response = await fetch("/api/casting-catalogues?pageSize=20");
      const data = await response.json();
      if (response.ok) setCatalogues(data.catalogues);
    } catch { /* Selection remains usable if history cannot be loaded. */ }
  }, []);
  useEffect(() => { void loadCatalogues(); }, [loadCatalogues]);

  const addProducts = (products: ImportedCatalogueProduct[], missing: string[]) => {
    setSelected((current) => { const next = new Map(current); products.forEach((product) => next.set(product.barcode, product)); return next; });
    setError("");
    setNotice(`${products.length} product${products.length === 1 ? "" : "s"} added${missing.length ? `; ${missing.length} barcode${missing.length === 1 ? " was" : "s were"} not found` : ""}.`);
  };

  const createCatalogue = async () => {
    setError(""); setCreatedUrl(""); setCreating(true);
    try {
      const response = await fetch("/api/casting-catalogues", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, productBarcodes: [...selected.values()].filter((product) => !onlyInStock || !product.isSold).map((product) => product.barcode), visibleFields, discounts: { pricePercent: priceDiscountPercent, usdPercent: usdDiscountPercent } }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create catalogue");
      const url = `${window.location.origin}/catalogue/${data.token}`;
      setCreatedUrl(url); setSelected(new Map()); setTitle(""); setNotice("");
      await loadCatalogues();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create catalogue"); }
    finally { setCreating(false); }
  };

  const selectedProducts = [...selected.values()].filter((product) => !onlyInStock || !product.isSold);
  const displayDiscounted = (raw: string, percent: number) => {
    const number = Number(raw.replace(/,/g, "").trim());
    if (!raw || !Number.isFinite(number)) return raw || "—";
    const discounted = Math.round(number * (1 - percent / 100) * 100) / 100;
    return percent > 0 ? `${discounted.toLocaleString()} (${percent}% off)` : number.toLocaleString();
  };
  const hasVisibleField = useMemo(() => CASTING_CATALOGUE_FIELDS.some((field) => visibleFields[field]), [visibleFields]);
  const absoluteUrl = (token: string) => typeof window === "undefined" ? `/catalogue/${token}` : `${window.location.origin}/catalogue/${token}`;
  const copyLink = async (url: string) => navigator.clipboard.writeText(url);

  const deleteCatalogue = async (catalogue: PreviousCatalogue) => {
    if (deletingToken || !window.confirm(`Delete "${catalogue.title || "Untitled catalogue"}"?\n\nThis shared link will stop working. Products and existing enquiries will be preserved.`)) return;
    setDeletingToken(catalogue.token); setHistoryError(""); setHistoryNotice("");
    try {
      const response = await fetch(`/api/casting-catalogues/${encodeURIComponent(catalogue.token)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to delete this catalogue link.");
      setCatalogues((current) => current.filter((item) => item.token !== catalogue.token));
      if (createdUrl === absoluteUrl(catalogue.token)) setCreatedUrl("");
      setHistoryNotice("Catalogue link deleted. It can no longer be opened by customers.");
      await loadCatalogues();
    } catch (caught) { setHistoryError(caught instanceof Error ? caught.message : "Unable to delete this catalogue link. Please retry."); }
    finally { setDeletingToken(null); }
  };

  return <div className={styles.adminGrid}>
    <section className={styles.panel}>
      <div className={styles.sectionHeader}><div><h2>Select Casting products</h2><p>Add products using the same QR and barcode inputs as the Scanner.</p></div><strong>{selected.size} selected</strong></div>
      <CatalogueProductImporter disabled={creating} onProducts={addProducts} />
      <label className={styles.stockFilter}><input type="checkbox" checked={onlyInStock} onChange={(event) => setOnlyInStock(event.target.checked)} />Only include products currently in stock</label>
      {notice ? <div className={styles.notice}>{notice}</div> : null}{error ? <div className={styles.error}>{error}</div> : null}
      <div className={styles.tableWrap}><table className={styles.productTable}><thead><tr><th>Image</th><th>Barcode</th><th>Item No.</th><th>Stone</th><th>Tag Price</th><th>USD</th><th>Availability</th><th /></tr></thead><tbody>
        {selectedProducts.map((product) => <tr key={product.barcode}>
          <td>{product.primaryImageUrl ? <ProviderAwareImage loading="lazy" className={styles.thumb} primaryUrl={product.primaryImageUrl} fallbackUrl={product.fallbackImageUrl} alt={product.itemNo || product.barcode} /> : <span className={styles.noImage}>No image</span>}</td>
          <td>{product.barcode}</td><td>{product.itemNo || "—"}</td><td>{product.stone || "—"}</td><td>{displayDiscounted(product.tagPrice, priceDiscountPercent)}</td><td>{displayDiscounted(product.usd, usdDiscountPercent)}</td>
          <td><span className={product.isSold ? styles.soldLabel : styles.inStockLabel}>{product.isSold ? "Sold" : "In stock"}</span></td>
          <td><button type="button" className={styles.removeRowButton} onClick={() => setSelected((current) => { const next = new Map(current); next.delete(product.barcode); return next; })}>Remove</button></td>
        </tr>)}
        {!selectedProducts.length ? <tr><td colSpan={8}>{selected.size && onlyInStock ? "No in-stock products in the current selection." : "Use one of the four options above to add products."}</td></tr> : null}
      </tbody></table></div>
    </section>

    <aside className={styles.sideColumn}>
      <section className={styles.panel}><h2>Create shareable link</h2>
        <label className={styles.titleField}>Catalogue title (optional)<input maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <div className={styles.discountGrid}><label>Tag Price discount %<input type="number" min="0" max="100" step="0.01" value={priceDiscountPercent} onChange={(event) => setPriceDiscountPercent(Math.min(100, Math.max(0, Number(event.target.value) || 0)))} /></label><label>USD discount %<input type="number" min="0" max="100" step="0.01" value={usdDiscountPercent} onChange={(event) => setUsdDiscountPercent(Math.min(100, Math.max(0, Number(event.target.value) || 0)))} /></label></div>
        <fieldset className={styles.fields}><legend>Customer-visible fields</legend>{CASTING_CATALOGUE_FIELDS.map((field) => <label key={field}><input type="checkbox" checked={visibleFields[field]} onChange={() => setVisibleFields((current) => ({ ...current, [field]: !current[field] }))} />{CASTING_CATALOGUE_FIELD_LABELS[field]}</label>)}</fieldset>
        <button className={styles.primaryButton} disabled={!selectedProducts.length || !hasVisibleField || creating} onClick={createCatalogue}>{creating ? "Generating…" : "Generate Catalogue Link"}</button>
        {createdUrl ? <div className={styles.success}><span>Catalogue created</span><a href={createdUrl} target="_blank" rel="noreferrer">{createdUrl}</a><button onClick={() => copyLink(createdUrl)}>Copy Link</button></div> : null}
      </section>
      <section className={styles.panel}><h2>Previously generated</h2>
        {historyError ? <div className={styles.error} role="alert">{historyError}</div> : null}
        {historyNotice ? <div className={styles.notice} role="status">{historyNotice}</div> : null}
        <div className={styles.history}>{catalogues.map((catalogue) => { const url = absoluteUrl(catalogue.token); return <article key={catalogue.token}><div><strong>{catalogue.title || "Untitled catalogue"}</strong><span>{catalogue.productCount} products · {new Date(catalogue.createdAt).toLocaleDateString()}</span></div><div><a href={url} target="_blank" rel="noreferrer">Open</a><button type="button" onClick={() => copyLink(url)}>Copy Link</button><button type="button" className={styles.deleteLinkButton} disabled={deletingToken !== null} onClick={() => deleteCatalogue(catalogue)}>{deletingToken === catalogue.token ? "Deleting…" : "Delete"}</button></div></article>; })}{!catalogues.length ? <p>No catalogues generated yet.</p> : null}</div>
      </section>
    </aside>
  </div>;
}
