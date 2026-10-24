"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  MAX_ADDITIONAL_CHANGES_LENGTH,
  MAX_RING_SIZE_LENGTH,
  MAX_STONE_COLOR_LENGTH,
  type ProductCustomization,
} from "@/lib/castingCatalogueEnquiryValidation";
import styles from "./InteractiveCatalogue.module.css";

type Props = {
  productName: string;
  initialValue?: ProductCustomization;
  onDone: (value: ProductCustomization) => void;
  onClose: () => void;
};

export default function CustomizationDialog({ productName, initialValue, onDone, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [draft, setDraft] = useState<ProductCustomization>({ ...initialValue });

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return <dialog ref={dialogRef} className={styles.customizationDialog} aria-labelledby={headingId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <form onSubmit={(event) => { event.preventDefault(); onDone({ ringSize: draft.ringSize?.trim(), stoneColor: draft.stoneColor?.trim(), additionalChanges: draft.additionalChanges?.trim() }); }}>
      <header className={styles.customizationHeader}><div><span>Make it yours</span><h2 id={headingId}>Customize your jewellery</h2><p>{productName}</p></div><button type="button" aria-label="Close customization" onClick={onClose}>×</button></header>
      <div className={styles.customizationFields}>
        <p>Share your preferences below. All fields are optional.</p>
        <label>Ring size<input autoFocus maxLength={MAX_RING_SIZE_LENGTH} placeholder="e.g. 12 or US 6" value={draft.ringSize || ""} onChange={(event) => setDraft((current) => ({ ...current, ringSize: event.target.value }))} /></label>
        <label>Stone color<input maxLength={MAX_STONE_COLOR_LENGTH} placeholder="e.g. Blue sapphire" value={draft.stoneColor || ""} onChange={(event) => setDraft((current) => ({ ...current, stoneColor: event.target.value }))} /></label>
        <label>Additional changes<textarea rows={4} maxLength={MAX_ADDITIONAL_CHANGES_LENGTH} placeholder="e.g. Rose gold plating or a different finish" value={draft.additionalChanges || ""} onChange={(event) => setDraft((current) => ({ ...current, additionalChanges: event.target.value }))} /><small>{draft.additionalChanges?.length || 0}/{MAX_ADDITIONAL_CHANGES_LENGTH}</small></label>
      </div>
      <footer className={styles.customizationFooter}><button type="button" className={styles.customizeButton} onClick={onClose}>Cancel</button><button type="submit" className={styles.primaryButton}>Done</button></footer>
    </form>
  </dialog>;
}
