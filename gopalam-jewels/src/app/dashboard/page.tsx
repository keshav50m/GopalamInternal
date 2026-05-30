"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import DashboardCharts from "@/components/dashboard/DashboardCharts";
import DashboardSearch from "@/components/dashboard/DashboardSearch";
import DashboardStats from "@/components/dashboard/DashboardStats";
import DashboardTables from "@/components/dashboard/DashboardTables";
import type { SavedProduct } from "@/components/dashboard/types";
import {
  buildStats,
  buildStoneDistribution,
  buildUploadTrend,
  hasImage,
  sortByRecentUpload,
} from "@/components/dashboard/dashboardUtils";
import styles from "@/components/dashboard/Dashboard.module.css";

export default function DashboardPage() {
  const [products, setProducts] = useState<SavedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await fetch("/api/saved-products");
        if (!response.ok) {
          throw new Error("Unable to load saved products");
        }

        const data = await response.json();
        setProducts(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load saved products");
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, []);

  const stats = useMemo(() => buildStats(products), [products]);
  const stoneDistribution = useMemo(() => buildStoneDistribution(products), [products]);
  const uploadTrend = useMemo(() => buildUploadTrend(products), [products]);
  const missingImages = useMemo(
    () => sortByRecentUpload(products.filter((product) => !hasImage(product))),
    [products]
  );
  const recentUploads = useMemo(() => sortByRecentUpload(products), [products]);

  return (
    <main className={styles.dashboardShell}>
      <header className={styles.topBar}>
        <div className={styles.topBarInner}>
          <div className={styles.brandBlock}>
            <span>Gopalam Jewels</span>
            <h1>Admin Dashboard</h1>
          </div>

          <nav className={styles.navLinks} aria-label="Primary navigation">
            <Link className={styles.navLink} href="/">
              Scanner
            </Link>
            <Link className={styles.activeNavLink} href="/dashboard">
              Dashboard
            </Link>
          </nav>
        </div>
      </header>

      <div className={styles.content}>
        {loading ? <div className={styles.statusBar}>Loading saved products...</div> : null}
        {error ? <div className={styles.errorBox}>{error}</div> : null}

        <DashboardStats stats={stats} />
        <DashboardCharts stoneDistribution={stoneDistribution} uploadTrend={uploadTrend} />
        <DashboardSearch products={products} />
        <DashboardTables missingImages={missingImages} recentUploads={recentUploads} />
      </div>
    </main>
  );
}
