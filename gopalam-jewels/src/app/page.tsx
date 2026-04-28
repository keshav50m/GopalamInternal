"use client";
import { useState } from "react";
import AdminPanel from "@/components/AdminPanel";
import ProductPanel from "@/components/ProductLookup";

export default function Page() {
  const [products, setProducts] = useState<any[]>([]);           // Excel data
  const [activeTab, setActiveTab] = useState<"admin" | "product">("admin");
  
  // New state to persist added rows across tab switches
  const [savedRows, setSavedRows] = useState<any[]>([
    { barcode: "", image: "", data: null },
  ]);

  return (
    <div className="wrapper">
      {/* HEADER */}
      <div className="header">
        <div className="header-inner">
          <img 
            src="https://res.cloudinary.com/dbaqd32pw/image/upload/v1777281635/Screenshot_2026-04-27_at_2.42.37_PM_i6xzap.png" 
            className="logo" 
            alt="Gopalam Jewels"
          />

          <div className="nav">
            <button 
              onClick={() => setActiveTab("admin")}
              className={activeTab === "admin" ? "active" : ""}
            >
              Admin Panel
            </button>
            <button 
              onClick={() => setActiveTab("product")}
              className={activeTab === "product" ? "active" : ""}
            >
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
            <ProductPanel 
              products={products} 
              rows={savedRows} 
              setRows={setSavedRows}
            />
          )}
        </div>
      </div>
    </div>
  );
}