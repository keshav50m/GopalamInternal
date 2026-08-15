import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gopalam Jewels — Product Lookup",
  description: "Premium product lookup system for Gopalam Jewels",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
