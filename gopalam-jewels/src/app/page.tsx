"use client";
import { useState } from "react";
import Header from "@/components/Header";
import ProductLookup from "@/components/ProductLookup";
import AdminPanel from "@/components/AdminPanel";

export default function Home() {
  const [activeTab, setActiveTab] = useState<"lookup" | "admin">("lookup");
  const [products, setProducts] = useState<any[]>([]);

  return (
    <main style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fdf8f0 0%, #fef9f0 100%)" }}>
      <Header />

      {/* Tab Bar */}
      <div style={{ background: "#1a1a1a", padding: "0 24px", display: "flex", justifyContent: "center" }}>
        {[
          { key: "lookup", label: "🔍 Product Lookup" },
          { key: "admin", label: "⚙️ Admin Panel" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            style={{
              padding: "16px 32px",
              fontFamily: "Inter, sans-serif",
              fontSize: "14px",
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              transition: "all 0.2s",
              borderBottom: activeTab === tab.key ? "3px solid #C9A84C" : "3px solid transparent",
              color: activeTab === tab.key ? "#C9A84C" : "#9CA3AF",
              background: "transparent",
              letterSpacing: "0.5px",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "40px 24px" }}>
        {activeTab === "lookup" ? (
          <ProductLookup products={products} />
        ) : (
          <AdminPanel onDataLoaded={setProducts} />
        )}
      </div>
    </main>
  );
}