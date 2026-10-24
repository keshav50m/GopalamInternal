"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import ProviderAwareImage from "@/components/ProviderAwareImage";
import { resolveImageCandidates } from "@/utils/imageProvider";
import { downloadPdfResponse } from "./downloadPdf";
import styles from "./InteractiveCatalogue.module.css";

type Enquiry = Record<string, any>;

export default function EnquiriesAdmin() {
  const [items, setItems] = useState<Enquiry[]>([]);
  const [selected, setSelected] = useState<Enquiry | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [error, setError] = useState("");
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/casting-catalogues/enquiries?page=${page}`);
    const data = await response.json();
    if (response.ok) {
      setItems(data.enquiries);
      setPages(Math.max(1, Math.ceil(data.total / data.pageSize)));
    } else setError(data.error);
  }, [page]);
  useEffect(() => { void load(); }, [load]);

  const view = async (id: string) => {
    if (selected?.enquiryId === id) { setSelected(null); return; }
    try {
      const response = await fetch(`/api/casting-catalogues/enquiries/${id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to open enquiry.");
      setSelected(data.enquiry);
      await load();
      requestAnimationFrame(() => document.getElementById(`enquiry-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to open enquiry."); }
  };

  const download = async (id: string) => {
    if (pdfBusy) return;
    setPdfBusy(id); setError("");
    try {
      const response = await fetch(`/api/casting-catalogues/enquiries/${encodeURIComponent(id)}/download`, { cache: "no-store" });
      await downloadPdfResponse(response, id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to generate PDF. Please retry."); }
    finally { setPdfBusy(null); }
  };

  const pdfButton = (id: string) => <button className={styles.primaryButton} disabled={pdfBusy !== null} onClick={() => download(id)}>{pdfBusy === id ? "Preparing PDF…" : "Download PDF"}</button>;

  const detail = (enquiry: Enquiry) => <div className={styles.inlineEnquiryDetail}>
    <div className={styles.inlineEnquiryHeader}>
      <div><h3>{enquiry.enquiryId}</h3><p><strong>{enquiry.customer.name}</strong> {enquiry.customer.mobile || ""}</p></div>
      <div className={styles.rowActions}>{pdfButton(enquiry.enquiryId)}<button className={styles.secondaryButton} onClick={() => setSelected(null)}>Close</button></div>
    </div>
    {enquiry.customer.remarks ? <p>Remarks: {enquiry.customer.remarks}</p> : null}
    <p>{enquiry.catalogueTitle} · {enquiry.totalQuantity} total quantity</p>
    <div className={styles.enquiryProducts}>{enquiry.products.map((product: any) => {
      const image = resolveImageCandidates({ image: product.image, r2Image: product.r2Image, provider: "r2" });
      return <article key={product.barcode}>
        {enquiry.visibleFields.image && image.primaryUrl ? <ProviderAwareImage loading="lazy" primaryUrl={image.primaryUrl} fallbackUrl={image.fallbackUrl} alt={product.itemNo || product.barcode} /> : null}
        <div><strong>{product.barcode}</strong><span>Item: {product.itemNo || "-"}</span><span>Quantity: {product.quantity}</span>{Object.entries(product.visibleDetails).map(([key, value]) => <span key={key}>{key}: {String(value)}</span>)}{product.customization?.ringSize ? <span>Ring size: {product.customization.ringSize}</span> : null}{product.customization?.stoneColor ? <span>Stone color: {product.customization.stoneColor}</span> : null}{product.customization?.additionalChanges ? <span>Additional changes: {product.customization.additionalChanges}</span> : null}</div>
      </article>;
    })}</div>
  </div>;

  return <div className={styles.enquiriesLayout}><section className={styles.panel}>
    <h2>Customer Enquiries</h2>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    <div className={styles.tableWrap}><table className={styles.productTable}>
      <thead><tr><th>Reference</th><th>Customer</th><th>Catalogue</th><th>Submitted</th><th>Products</th><th>Status</th><th>PDF</th><th /></tr></thead>
      <tbody>{items.map((item) => <Fragment key={item.enquiryId}>
        <tr><td>{item.enquiryId}{item.notificationStatus === "unread" ? " •" : ""}</td><td>{item.customer.name}<br />{item.customer.mobile || ""}</td><td>{item.catalogueTitle}</td><td>{new Date(item.submittedAt).toLocaleString()}</td><td>{item.distinctProductCount} / {item.totalQuantity} qty</td><td>{item.status}</td><td>On demand</td><td><div className={styles.rowActions}><button className={styles.primaryButton} onClick={() => view(item.enquiryId)}>{selected?.enquiryId === item.enquiryId ? "Hide" : "View"}</button>{pdfButton(item.enquiryId)}</div></td></tr>
        {selected && selected.enquiryId === item.enquiryId ? <tr id={`enquiry-${item.enquiryId}`} className={styles.enquiryDetailRow}><td colSpan={8}>{detail(selected)}</td></tr> : null}
      </Fragment>)}</tbody>
    </table></div>
    <div className={styles.pagination}><span>Page {page} of {pages}</span><div><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div></div>
  </section></div>;
}
