"use client";

export default function Header() {
  return (
    <header style={{ background: "linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)", padding: "0", borderBottom: "1px solid #2a2a2a" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: "linear-gradient(135deg, #9A7A30, #C9A84C, #E8C97A)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", boxShadow: "0 0 20px rgba(201,168,76,0.3)" }}>
            💎
          </div>
          <div>
            <h1 style={{ fontFamily: "Playfair Display, serif", fontSize: "26px", fontWeight: 700, color: "#C9A84C", margin: 0, letterSpacing: "1px" }}>
              Gopalam Jewels
            </h1>
            <p style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", color: "#6B7280", margin: 0, letterSpacing: "2px", textTransform: "uppercase" }}>
              Product Lookup System
            </p>
          </div>
        </div>
        <a href="https://gopalamjewels.in" target="_blank" rel="noopener noreferrer" style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", color: "#C9A84C", textDecoration: "none", border: "1px solid #C9A84C", padding: "8px 16px", borderRadius: "6px", transition: "all 0.2s" }}>
          Visit Website
        </a>
      </div>
      <div style={{ height: "2px", background: "linear-gradient(90deg, transparent, #9A7A30, #C9A84C, #E8C97A, #C9A84C, #9A7A30, transparent)" }}></div>
    </header>
  );
}