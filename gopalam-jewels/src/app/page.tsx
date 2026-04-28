"use client";
import ProductPanel from "@/components/ProductLookup";

export default function Page() {
  return (
    <div className="wrapper">
      <div className="header">
        <div className="header-inner">
          <img 
            src="https://res.cloudinary.com/dbaqd32pw/image/upload/v1777281635/Screenshot_2026-04-27_at_2.42.37_PM_i6xzap.png" 
            className="logo" 
            alt="Gopalam Jewels"
          />
          <h1>Gopalam Jewels - Barcode Scanner</h1>
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