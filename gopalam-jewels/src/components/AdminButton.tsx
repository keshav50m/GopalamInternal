"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function AdminButton() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;

    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((user) => {
        if (active) setIsAdmin(user?.role === "admin");
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (!isAdmin) return null;

  return (
    <Link
      href="/admin"
      aria-label="Admin Settings"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        flexShrink: 0,
        padding: "7px 10px",
        border: "1px solid #bda76e",
        borderRadius: "999px",
        background: "#fffaf0",
        color: "#66501d",
        fontSize: "12px",
        fontWeight: 800,
        textDecoration: "none",
      }}
    >
      <span aria-hidden="true">⚙</span>
      Admin
    </Link>
  );
}
