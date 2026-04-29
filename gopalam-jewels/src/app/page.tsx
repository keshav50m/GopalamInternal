"use client";
import ProductPanel from "@/components/ProductLookup";

export default function Page() {
  return (
    <div className="wrapper">
      <div className="header">
        <div className="header-inner">
          <img 
            src="https://res.cloudinary.com/dbaqd32pw/image/upload/v1777457314/Screenshot_2026-04-29_at_3.38.16_PM_lqxdn7.png" 
            className="logo" 
            alt="Gopalam Jewels"
          />
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