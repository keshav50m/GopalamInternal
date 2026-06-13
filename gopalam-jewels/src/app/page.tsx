"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProductPanel from "@/components/ProductLookup";

export default function Page() {
  const [jewelleryType, setJewelleryType] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("jewelleryType");
    if (saved) {
      setJewelleryType(saved);
    }
  }, []);

  const selectType = (type: "casting" | "polki") => {
    localStorage.setItem("jewelleryType", type);
    setJewelleryType(type);
  };

  const resetType = () => {
    localStorage.removeItem("jewelleryType");
    setJewelleryType(null);
  };

  if (!jewelleryType) {
    if (!jewelleryType) {
      return (
        <div
          style={{
            minHeight: "100vh",
            background: "#f5f3ef",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "30px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "20px",
              padding: "60px",
              width: "100%",
              maxWidth: "900px",
              boxShadow: "0 10px 40px rgba(0,0,0,0.08)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                color: "#9a7a30",
                fontWeight: 700,
                letterSpacing: "2px",
                marginBottom: "12px",
                fontSize: "18px",
              }}
            >
              GOPALAM GEMS & JEWELLERY
            </div>

            <h1
              style={{
                fontSize: "48px",
                marginBottom: "10px",
                color: "#222",
              }}
            >
              Product Management System
            </h1>

            <p
              style={{
                color: "#666",
                marginBottom: "50px",
                fontSize: "18px",
              }}
            >
              Select the jewellery category to continue
            </p>

            <div
              style={{
                display: "flex",
                gap: "30px",
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={() => selectType("casting")}
                style={{
                  width: "280px",
                  height: "180px",
                  borderRadius: "16px",
                  border: "2px solid #d8c89f",
                  background: "#ffffff",
                  cursor: "pointer",
                  transition: "0.2s",
                }}
              >
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: 700,
                    color: "#9a7a30",
                    marginBottom: "15px",
                  }}
                >
                  Casting Jewellery
                </div>

                <div
                  style={{
                    color: "#666",
                    fontSize: "15px",
                  }}
                >
                  Scanner, Dashboard,
                  <br />
                  Image Catalogue,
                  <br />
                  Custom Search
                </div>
              </button>

              <button
                onClick={() => selectType("polki")}
                style={{
                  width: "280px",
                  height: "180px",
                  borderRadius: "16px",
                  border: "2px solid #d8c89f",
                  background: "#ffffff",
                  cursor: "pointer",
                  transition: "0.2s",
                }}
              >
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: 700,
                    color: "#9a7a30",
                    marginBottom: "15px",
                  }}
                >
                  Polki Jewellery
                </div>

                <div
                  style={{
                    color: "#666",
                    fontSize: "15px",
                  }}
                >
                  Dedicated Polki
                  <br />
                  Product Management
                  <br />
                  Module
                </div>
              </button>
            </div>

            <div
              style={{
                marginTop: "50px",
                color: "#999",
                fontSize: "14px",
              }}
            >
              © Gopalam Gems & Jewellery
            </div>
          </div>
        </div>
      );
    }
  }

  if (jewelleryType === "polki") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          background: "#f5f3ef",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <h1>Polki Jewellery</h1>

          <h2>🚧 Work Under Construction</h2>

          <p>
            This module is currently being developed and will be available soon.
          </p>

          <button
            onClick={resetType}
            style={{
              marginTop: "20px",
              padding: "12px 25px",
              cursor: "pointer",
            }}
          >
            Back To Selection
          </button>
        </div>
      </div>
    );
  }

  // return (
  //   <div className="wrapper">
  //     <div className="header">
  //       <div className="header-inner">
  //         <img
  //           src="https://res.cloudinary.com/dbaqd32pw/image/upload/v1777457314/Screenshot_2026-04-29_at_3.38.16_PM_lqxdn7.png"
  //           className="logo"
  //           alt="Gopalam Jewels"
  //         />

  //         <nav style={{ display: "flex", gap: "10px", marginLeft: "auto" }}>
  //           <Link
  //             href="/"
  //             style={{
  //               color: "#ffffff",
  //               background: "#9a7a30",
  //               border: "1px solid #9a7a30",
  //               borderRadius: "6px",
  //               padding: "9px 14px",
  //               textDecoration: "none",
  //               fontSize: "14px",
  //               fontWeight: 700,
  //             }}
  //           >
  //             Scanner
  //           </Link>

  //           <Link
  //             href="/dashboard"
  //             style={{
  //               color: "#43391f",
  //               background: "#ffffff",
  //               border: "1px solid #d8c89f",
  //               borderRadius: "6px",
  //               padding: "9px 14px",
  //               textDecoration: "none",
  //               fontSize: "14px",
  //               fontWeight: 700,
  //             }}
  //           >
  //             Dashboard
  //           </Link>

  //           <Link
  //             href="/image-catalogue"
  //             style={{
  //               color: "#43391f",
  //               background: "#ffffff",
  //               border: "1px solid #d8c89f",
  //               borderRadius: "6px",
  //               padding: "9px 14px",
  //               textDecoration: "none",
  //               fontSize: "14px",
  //               fontWeight: 700,
  //             }}
  //           >
  //             Image Catalogue
  //           </Link>

  //           <Link
  //             href="/custom-search"
  //             style={{
  //               color: "#43391f",
  //               background: "#ffffff",
  //               border: "1px solid #d8c89f",
  //               borderRadius: "6px",
  //               padding: "9px 14px",
  //               textDecoration: "none",
  //               fontSize: "14px",
  //               fontWeight: 700,
  //             }}
  //           >
  //             Custom Search
  //           </Link>

  //           <button
  //             onClick={resetType}
  //             style={{
  //               color: "#ffffff",
  //               background: "#dc2626",
  //               border: "1px solid #dc2626",
  //               borderRadius: "6px",
  //               padding: "9px 14px",
  //               fontSize: "14px",
  //               fontWeight: 700,
  //               cursor: "pointer",
  //             }}
  //           >
  //             Change Type
  //           </button>
  //         </nav>
  //       </div>
  //     </div>

  //     <div className="container">
  //       <div className="card">
  //         <ProductPanel />
  //       </div>
  //     </div>
  //   </div>
  // );

  if (jewelleryType === "casting") {
    if (typeof window !== "undefined") {
      window.location.href = "/scanner";
    }

    return null;
  }
}