"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import AdminButton from "@/components/AdminButton";
import ChangeTypeButton from "@/components/ChangeTypeButton";
import DashboardCharts from "@/components/dashboard/DashboardCharts";
import type { ChartPoint } from "@/components/dashboard/types";
import styles from "@/components/dashboard/Dashboard.module.css";

type Product = { _id: string; barcode?: string | number; data?: Record<string, string>; sold?: boolean; updatedAt?: string };
type Data = { stats: Record<"total" | "sold" | "available" | "today" | "month", number>; karats: ChartPoint[]; trend: ChartPoint[]; recentProducts: Product[]; generatedAt: string };
const cards = [["total", "Total Products"], ["available", "Available Products"], ["sold", "Sold Products"], ["today", "Updated Today"], ["month", "Updated This Month"]] as const;

function Products({ products }: { products: Product[] }) {
  if (!products.length) return <p className={styles.emptyState}>No products found.</p>;
  return <div style={{ overflowX: "auto" }}><table className={styles.dashboardTable}>
    <thead><tr>{["Barcode", "Lot No", "Karat", "Gross Wt", "Net Wt", "Status", "Updated"].map(label => <th key={label}>{label}</th>)}</tr></thead>
    <tbody>{products.map(product => <tr key={product._id}>
      <td>{product.barcode || product.data?.BARCODE || "—"}</td><td>{product.data?.["LOT NO"] || "—"}</td><td>{product.data?.KARAT1 || "—"}</td>
      <td>{product.data?.GW || "—"}</td><td>{product.data?.NW || "—"}</td><td>{product.sold ? "Sold" : "Available"}</td>
      <td>{product.updatedAt && !Number.isNaN(Date.parse(product.updatedAt)) ? new Date(product.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</td>
    </tr>)}</tbody>
  </table></div>;
}

export default function GoldDashboardPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/gold/dashboard", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Unable to load Gold dashboard.");
      setData(await response.json());
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true); setSearchError(""); setResults(null);
    try {
      const response = await fetch(`/api/gold/dashboard?query=${encodeURIComponent(query.trim())}`);
      if (!response.ok) throw new Error("Unable to search Gold products.");
      setResults((await response.json()).products);
    } catch (err) { setSearchError(err instanceof Error ? err.message : "Search failed."); }
    finally { setSearching(false); }
  }
  return <main className={styles.dashboardShell}>
    <header className={styles.topBar}><div className={styles.topBarInner}>
      <div className={styles.brandArea}><ChangeTypeButton /><div className={styles.brandBlock}><span>Gopalam Jewels</span><h1>Gold Dashboard</h1></div></div>
      <AdminButton /><nav className={styles.navLinks} aria-label="Gold navigation"><Link className={styles.navLink} href="/gold/scanner">Gold Scanner</Link><Link className={styles.activeNavLink} href="/gold/dashboard" aria-current="page">Dashboard</Link><Link className={styles.navLink} href="/gold/custom-search">Custom Search</Link></nav>
    </div></header>
    <div className={styles.content}>
      <div className={styles.statusBar}>Summary refreshes within 60 seconds. Dates use India time. <button onClick={() => setRefresh(value => value + 1)} disabled={loading}>Refresh</button></div>
      {loading && <p role="status">Loading Gold inventory…</p>}
      {error && <p className={styles.errorBox} role="alert">{error}</p>}
      {data && <><section className={styles.statsGrid} aria-label="Gold inventory statistics">{cards.map(([key, label]) => <div className={styles.statCard} key={key}><span>{label}</span><strong>{data.stats[key].toLocaleString("en-IN")}</strong></div>)}</section>
        <DashboardCharts stoneDistribution={data.karats} uploadTrend={data.trend} distributionTitle="Karat Distribution" distributionEmptyLabel="No karat data available" />
      </>}
      <section className={styles.panel}><div className={styles.panelHeader}><h2>Find Gold Products</h2></div>
        <form onSubmit={search} style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><label htmlFor="gold-query">Exact barcode or lot number</label><input id="gold-query" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} required /><button disabled={searching || !query.trim()}>{searching ? "Searching…" : "Search"}</button></form>
        <p>Shows up to 20 matching products. Searches use current inventory.</p>{searchError && <p role="alert">{searchError}</p>}{results && <Products products={results} />}
      </section>
      {data && <section className={styles.panel}><div className={styles.panelHeader}><h2>Recent Updates</h2></div><Products products={data.recentProducts} /></section>}
    </div>
  </main>;
}
