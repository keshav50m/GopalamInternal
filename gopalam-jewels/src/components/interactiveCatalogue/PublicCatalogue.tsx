"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProviderAwareImage from "@/components/ProviderAwareImage";
import { CASTING_CATALOGUE_FIELDS, CASTING_CATALOGUE_FIELD_LABELS, type CastingCatalogueFieldSettings } from "@/lib/castingCatalogue";
import { MAX_CUSTOMER_NAME_LENGTH, MAX_ENQUIRY_QUANTITY, MAX_MOBILE_LENGTH, MAX_REMARKS_LENGTH, calculatePermittedTotals, type ProductCustomization } from "@/lib/castingCatalogueEnquiryValidation";
import styles from "./InteractiveCatalogue.module.css";
import { downloadPdfResponse } from "./downloadPdf";
import CustomizationDialog from "./CustomizationDialog";

type DetailField = Exclude<(typeof CASTING_CATALOGUE_FIELDS)[number], "image">;
type PublicProduct = { selectionId: string; values: Partial<Record<DetailField, string>>; primaryImageUrl?: string; fallbackImageUrl?: string; isSold?: boolean };
type CartEntry = PublicProduct & { quantity: number; customization?: ProductCustomization };
type Props = { token: string };

const formatTotal = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function PublicCatalogue({ token }: Props) {
  const [title, setTitle] = useState("Casting Jewellery Catalogue");
  const [visibleFields, setVisibleFields] = useState<CastingCatalogueFieldSettings | null>(null);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cart, setCart] = useState<Map<string, CartEntry>>(new Map());
  const [cartOpen, setCartOpen] = useState(false);
  const [customizing, setCustomizing] = useState<PublicProduct | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [mobile, setMobile] = useState("");
  const [remarks, setRemarks] = useState("");
  const submissionKeyRef = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [confirmation, setConfirmation] = useState<{ enquiryId: string; accessToken: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "24" });
      const response = await fetch(`/api/catalogue/${encodeURIComponent(token)}?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load catalogue");
      setTitle(data.catalogue.title); setVisibleFields(data.catalogue.visibleFields); setProducts(data.products);
      setTotal(data.total); setPageCount(Math.max(1, Math.ceil(data.total / data.pageSize)));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load catalogue"); }
    finally { setLoading(false); }
  }, [page, token]);
  useEffect(() => { load(); }, [load]);

  const detailFields = CASTING_CATALOGUE_FIELDS.filter((field): field is DetailField => field !== "image" && Boolean(visibleFields?.[field]));
  const cartEntries = useMemo(() => [...cart.values()], [cart]);
  const totalQuantity = useMemo(() => cartEntries.reduce((sum, entry) => sum + entry.quantity, 0), [cartEntries]);
  const totals = useMemo(() => calculatePermittedTotals(
    cartEntries.map((entry) => ({ price: entry.values.price, usd: entry.values.usd, quantity: entry.quantity })),
    { price: Boolean(visibleFields?.price), usd: Boolean(visibleFields?.usd) }
  ), [cartEntries, visibleFields]);

  const payloadChanged = () => { submissionKeyRef.current = null; setSubmissionError(""); setConfirmation(null); };
  const addProduct = (product: PublicProduct) => {
    payloadChanged();
    setCart((current) => { const next = new Map(current); if (!next.has(product.selectionId)) next.set(product.selectionId, { ...product, quantity: 1 }); return next; });
  };
  const setQuantity = (selectionId: string, requested: number) => {
    const quantity = Math.min(MAX_ENQUIRY_QUANTITY, Math.max(1, Math.trunc(requested || 1)));
    payloadChanged();
    setCart((current) => { const next = new Map(current); const entry = next.get(selectionId); if (entry) next.set(selectionId, { ...entry, quantity }); return next; });
  };
  const removeProduct = (selectionId: string) => {
    payloadChanged(); setCart((current) => { const next = new Map(current); next.delete(selectionId); return next; });
  };
  const saveCustomization = (customization: ProductCustomization) => {
    if (!customizing) return;
    payloadChanged();
    setCart((current) => { const next = new Map(current); const entry = next.get(customizing.selectionId); next.set(customizing.selectionId, { ...customizing, ...entry, quantity: entry?.quantity || 1, customization }); return next; });
    setCustomizing(null);
  };

  const submitEnquiry = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!customerName.trim()) { setSubmissionError("Customer name is required."); return; }
    if (!cartEntries.length) { setSubmissionError("Add at least one product to your selection."); return; }
    const key = submissionKeyRef.current || crypto.randomUUID();
    submissionKeyRef.current = key; setSubmitting(true); setSubmissionError("");
    try {
      const response = await fetch(`/api/catalogue/${encodeURIComponent(token)}/enquiry`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionKey: key, customer: { name: customerName.trim(), mobile: mobile.trim(), remarks: remarks.trim() }, selections: cartEntries.map((entry) => ({ selectionId: entry.selectionId, quantity: entry.quantity, customization: entry.customization })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to submit your selection");
      setConfirmation({ enquiryId: data.enquiryId, accessToken: data.customerAccessToken }); setCart(new Map()); setCartOpen(false); submissionKeyRef.current = null;
    } catch (caught) { setSubmissionError(caught instanceof Error ? caught.message : "Unable to submit your selection. Please try again."); }
    finally { setSubmitting(false); }
  };

  const downloadPdf = async () => {
    if (!confirmation) return; setPdfBusy(true); setPdfError("");
    try {
      const base = `/api/catalogue/${encodeURIComponent(token)}/enquiry/${encodeURIComponent(confirmation.enquiryId)}`;
      const response = await fetch(`${base}/pdf`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: confirmation.accessToken }) });
      await downloadPdfResponse(response, confirmation.enquiryId);
    } catch (caught) { setPdfError(caught instanceof Error ? caught.message : "PDF generation failed. Please retry."); }
    finally { setPdfBusy(false); }
  };

  if (confirmation) return <main className={styles.publicShell}>
    <header className={styles.publicHeader}><Image src="/gopalam-jewels-logo.png" width={74} height={74} priority alt="Gopalam Jewels" /><div><span>Gopalam Jewels</span><h1>{title}</h1></div></header>
    <section className={styles.confirmationPage}><div className={styles.confirmation} role="status"><strong>Your selection has been submitted successfully.</strong><span>Enquiry reference: {confirmation.enquiryId}</span><button className={styles.primaryButton} disabled={pdfBusy} onClick={downloadPdf}>{pdfBusy ? "Preparing PDF…" : pdfError ? "Retry PDF Generation" : "Download Selection PDF"}</button>{pdfError ? <span>{pdfError}</span> : null}</div></section>
  </main>;

  return <main className={styles.publicShell}>
    <header className={styles.publicHeader}><Image src="/gopalam-jewels-logo.png" width={74} height={74} priority alt="Gopalam Jewels" /><div><span>Gopalam Jewels</span><h1>{title}</h1><p>{total} products</p></div></header>
    <section className={styles.publicContent}>
      {error ? <div className={styles.publicError}>{error}</div> : null}{loading ? <div className={styles.publicStatus}>Loading catalogue…</div> : null}
      {!loading && !error ? <div className={styles.productGrid}>{products.map((product) => { const entry = cart.get(product.selectionId); const selected = Boolean(entry); return <article className={`${styles.productCard} ${selected ? styles.selectedProductCard : ""}`} key={product.selectionId}>
        {visibleFields?.image ? <div className={styles.productImage}>{product.primaryImageUrl ? <ProviderAwareImage loading="lazy" decoding="async" primaryUrl={product.primaryImageUrl} fallbackUrl={product.fallbackImageUrl} alt={product.values.item || product.values.barcode || "Casting jewellery"} /> : <span>Image unavailable</span>}</div> : null}
        <dl>{detailFields.map((field) => <div key={field}><dt>{CASTING_CATALOGUE_FIELD_LABELS[field]}</dt><dd>{product.values[field] || "—"}</dd></div>)}</dl>
        {product.isSold ? <div className={styles.soldBadge}>Sold</div> : null}
        <div className={styles.productActions}>
          <button type="button" className={styles.customizeButton} disabled={product.isSold} onClick={() => setCustomizing(product)}>Customize</button>
          {entry ? <div className={styles.cardQuantity}><button type="button" aria-label="Decrease quantity" onClick={() => entry.quantity <= 1 ? removeProduct(product.selectionId) : setQuantity(product.selectionId, entry.quantity - 1)}>−</button><strong>{entry.quantity}</strong><button type="button" aria-label="Increase quantity" disabled={entry.quantity >= MAX_ENQUIRY_QUANTITY} onClick={() => setQuantity(product.selectionId, entry.quantity + 1)}>+</button></div> : <button className={styles.addSelectionButton} disabled={product.isSold} onClick={() => addProduct(product)}>{product.isSold ? "Unavailable" : "Add to Cart"}</button>}
        </div>
        {entry?.customization && Object.values(entry.customization).some(Boolean) ? <p className={styles.customizationSaved}>Customization saved</p> : null}
      </article>; })}</div> : null}
      {!loading && !error && products.length === 0 ? <div className={styles.publicStatus}>No matching products.</div> : null}
      {!error && pageCount > 1 ? <div className={styles.publicPagination}><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div> : null}
    </section>
    {cartEntries.length ? <button className={styles.viewSelectionButton} onClick={() => setCartOpen(true)}>Go to Cart · {cartEntries.length} products · {totalQuantity} qty</button> : null}
    {cartOpen ? <div className={styles.cartOverlay} role="dialog" aria-modal="true" aria-labelledby="selection-heading"><section className={styles.cartPanel}>
      <div className={styles.cartHeader}><div><h2 id="selection-heading">Your Selection</h2><p>{cartEntries.length} distinct products · {totalQuantity} total quantity</p></div><button aria-label="Close selection" onClick={() => setCartOpen(false)}>×</button></div>
      <div className={styles.cartItems}>{cartEntries.map((entry) => <article className={styles.cartItem} key={entry.selectionId}>
        {visibleFields?.image ? <div className={styles.cartImage}>{entry.primaryImageUrl ? <ProviderAwareImage loading="lazy" primaryUrl={entry.primaryImageUrl} fallbackUrl={entry.fallbackImageUrl} alt={entry.values.item || entry.values.barcode || "Selected jewellery"} /> : <span>No image</span>}</div> : null}
        <div className={styles.cartItemDetails}><dl>{detailFields.map((field) => <div key={field}><dt>{CASTING_CATALOGUE_FIELD_LABELS[field]}</dt><dd>{entry.values[field] || "—"}</dd></div>)}</dl>
          <div className={styles.quantityRow}><span>Quantity</span><button type="button" disabled={entry.quantity <= 1} onClick={() => setQuantity(entry.selectionId, entry.quantity - 1)}>−</button><input type="number" min="1" max={MAX_ENQUIRY_QUANTITY} value={entry.quantity} onChange={(event) => setQuantity(entry.selectionId, Number(event.target.value))} aria-label={`Quantity for ${entry.values.item || entry.values.barcode || "product"}`} /><button type="button" disabled={entry.quantity >= MAX_ENQUIRY_QUANTITY} onClick={() => setQuantity(entry.selectionId, entry.quantity + 1)}>+</button><button type="button" className={styles.cartRemoveButton} onClick={() => removeProduct(entry.selectionId)}>Remove</button></div>
          {entry.customization && Object.values(entry.customization).some(Boolean) ? <div className={styles.cartCustomization}><strong>Customization</strong>{entry.customization.ringSize ? <span>Ring size: {entry.customization.ringSize}</span> : null}{entry.customization.stoneColor ? <span>Stone color: {entry.customization.stoneColor}</span> : null}{entry.customization.additionalChanges ? <span>Additional changes: {entry.customization.additionalChanges}</span> : null}<button type="button" onClick={() => setCustomizing(entry)}>Edit</button></div> : null}
        </div>
      </article>)}</div>
      {(visibleFields?.price || visibleFields?.usd) ? <div className={styles.cartTotals}>{visibleFields.price ? <div><span>Total Tag Price</span><strong>{formatTotal(totals.tagPrice || 0)}</strong></div> : null}{visibleFields.usd ? <div><span>Total USD</span><strong>{formatTotal(totals.usd || 0)}</strong></div> : null}</div> : null}
      <form className={styles.enquiryForm} onSubmit={submitEnquiry}><h3>Customer details</h3>
        <label>Name <span aria-hidden="true">*</span><input required maxLength={MAX_CUSTOMER_NAME_LENGTH} value={customerName} onChange={(event) => { payloadChanged(); setCustomerName(event.target.value); }} /></label>
        <label>WhatsApp / Mobile number <small>Optional</small><input inputMode="tel" maxLength={MAX_MOBILE_LENGTH} value={mobile} onChange={(event) => { payloadChanged(); setMobile(event.target.value); }} /></label>
        <label>Additional remarks <small>Optional</small><textarea maxLength={MAX_REMARKS_LENGTH} rows={4} value={remarks} onChange={(event) => { payloadChanged(); setRemarks(event.target.value); }} /></label>
        {submissionError ? <div className={styles.submitError} role="alert">{submissionError}</div> : null}<button className={styles.submitEnquiryButton} disabled={submitting || !cartEntries.length} type="submit">{submitting ? "Submitting…" : "Submit Enquiry"}</button>
      </form>
    </section></div> : null}
    {customizing ? <CustomizationDialog key={customizing.selectionId} productName={customizing.values.item || customizing.values.stone || "Selected jewellery"} initialValue={cart.get(customizing.selectionId)?.customization} onDone={saveCustomization} onClose={() => setCustomizing(null)} /> : null}
  </main>;
}
