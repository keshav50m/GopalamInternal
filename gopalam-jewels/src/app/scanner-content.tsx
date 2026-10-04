"use client";

import Link from "next/link";
import ProductPanel from "@/components/ProductLookup";
import AdminButton from "@/components/AdminButton";
import ChangeTypeButton from "@/components/ChangeTypeButton";

export default function ScannerPage() {
  return (
    <div className="wrapper">
      <div className="header">
        <div className="header-inner">
          <ChangeTypeButton />
          <img
            src="/gopalam-jewels-logo.png"
            className="logo"
            alt="Gopalam Jewels"
          />
          <AdminButton />

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
