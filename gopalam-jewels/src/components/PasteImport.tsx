"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  label: string;
  placeholder: string;
  onImport: (text: string) => void | Promise<void>;
  disabled?: boolean;
};

export default function PasteImport({ label, placeholder, onImport, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, busy]);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onImport(text);
      setText("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const dialog = open && typeof document !== "undefined"
    ? createPortal(
      <div
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setOpen(false);
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 10000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          background: "rgba(15, 18, 24, 0.58)",
          backdropFilter: "blur(3px)",
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          style={{
            width: "min(620px, 100%)",
            maxHeight: "calc(100vh - 40px)",
            overflowY: "auto",
            borderRadius: "14px",
            padding: "22px",
            background: "white",
            boxShadow: "0 24px 70px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
            <div>
              <h2 id={titleId} style={{ margin: 0, color: "#242424", fontSize: "22px" }}>{label}</h2>
              <p style={{ margin: "6px 0 16px", color: "#666", fontSize: "14px" }}>
                Paste the copied Excel values below, with one record on each line.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close paste dialog"
              onClick={() => setOpen(false)}
              disabled={busy}
              style={{ border: 0, background: "transparent", color: "#555", cursor: "pointer", fontSize: "28px", lineHeight: 1, padding: "0 2px" }}
            >
              ×
            </button>
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={placeholder}
            rows={10}
            autoFocus
            disabled={disabled || busy}
            style={{ width: "100%", boxSizing: "border-box", resize: "vertical", border: "1px solid #aaa", borderRadius: "8px", padding: "12px", font: "inherit", minHeight: "210px" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              style={{ border: "1px solid #aaa", borderRadius: "7px", padding: "9px 14px", background: "white", cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={disabled || busy || !text.trim()}
              style={{ border: 0, borderRadius: "7px", padding: "9px 14px", background: "#c9a84c", color: "white", fontWeight: 700, cursor: "pointer", opacity: disabled || busy || !text.trim() ? 0.6 : 1 }}
            >
              {busy ? "Importing…" : "Add pasted data"}
            </button>
          </div>
        </div>
      </div>,
      document.body
    )
    : null;

  return (
    <div style={{ marginTop: "8px" }}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || busy}
        style={{ border: "1px solid #aaa", borderRadius: "6px", padding: "7px 10px", background: "white", cursor: disabled ? "not-allowed" : "pointer" }}
      >
        {label}
      </button>
      {dialog}
    </div>
  );
}
