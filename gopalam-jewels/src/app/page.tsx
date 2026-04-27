"use client";
import { useState } from "react";
import AdminPanel from "@/components/AdminPanel";
import ProductPanel from "@/components/ProductLookup";

export default function Page() {
  const [products, setProducts] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState("admin");

  return (
    <div className="wrapper">

      {/* HEADER */}
      <div className="header">
        <div className="header-inner">
          <img src="https://res.cloudinary.com/dbaqd32pw/image/upload/v1777281635/Screenshot_2026-04-27_at_2.42.37_PM_i6xzap.png" className="logo" />

          <div className="nav">
            <button onClick={() => setActiveTab("admin")}>
              Admin Panel
            </button>
            <button onClick={() => setActiveTab("product")}>
              Product Panel
            </button>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="container">
        <div className="card">
          {activeTab === "admin" && (
            <AdminPanel setProducts={setProducts} products={products} />
          )}

          {activeTab === "product" && (
            <ProductPanel products={products} />
          )}
        </div>
      </div>

    </div>
  );
}