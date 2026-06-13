"use client";

import Link from "next/link";
import ProductPanel from "@/components/ProductLookup";

export default function ScannerPage() {
  const resetType = () => {
    localStorage.removeItem("jewelleryType");
    window.location.href = "/";
  };

  return (
    <div className="wrapper">
      <div className="header">
        <div className="header-inner">
          <img
            src="https://res.cloudinary.com/dbaqd32pw/image/upload/v1777457314/Screenshot_2026-04-29_at_3.38.16_PM_lqxdn7.png"
            className="logo"
            alt="Gopalam Jewels"
          />

          <nav style={{ display: "flex", gap: "10px", marginLeft: "auto" }}>
            <Link
              href="/scanner"
              style={{
                color: "#ffffff",
                background: "#9a7a30",
                border: "1px solid #9a7a30",
                borderRadius: "6px",
                padding: "9px 14px",
                textDecoration: "none",
                fontSize: "14px",
                fontWeight: 700,
              }}
            >
              Scanner
            </Link>

            <Link
              href="/dashboard"
              style={{
                color: "#43391f",
                background: "#ffffff",
                border: "1px solid #d8c89f",
                borderRadius: "6px",
                padding: "9px 14px",
                textDecoration: "none",
                fontSize: "14px",
                fontWeight: 700,
              }}
            >
              Dashboard
            </Link>

            <Link
              href="/image-catalogue"
              style={{
                color: "#43391f",
                background: "#ffffff",
                border: "1px solid #d8c89f",
                borderRadius: "6px",
                padding: "9px 14px",
                textDecoration: "none",
                fontSize: "14px",
                fontWeight: 700,
              }}
            >
              Image Catalogue
            </Link>

            <Link
              href="/custom-search"
              style={{
                color: "#43391f",
                background: "#ffffff",
                border: "1px solid #d8c89f",
                borderRadius: "6px",
                padding: "9px 14px",
                textDecoration: "none",
                fontSize: "14px",
                fontWeight: 700,
              }}
            >
              Custom Search
            </Link>

            <button
              onClick={resetType}
              style={{
                color: "#ffffff",
                background: "#dc2626",
                border: "1px solid #dc2626",
                borderRadius: "6px",
                padding: "9px 14px",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Change Type
            </button>
          </nav>
        </div>
      </div>

      <div className="container">
        <div className="card">
          <ProductPanel />
        </div>
      </div>
    </div>
  );
}