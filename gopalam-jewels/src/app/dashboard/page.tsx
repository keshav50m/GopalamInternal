"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DashboardCharts from "@/components/dashboard/DashboardCharts";
import DashboardSearch from "@/components/dashboard/DashboardSearch";
import DashboardStats from "@/components/dashboard/DashboardStats";
import DashboardTables from "@/components/dashboard/DashboardTables";
import type { DashboardData } from "@/components/dashboard/types";
import styles from "@/components/dashboard/Dashboard.module.css";
import AdminButton from "@/components/AdminButton";

export default function DashboardPage() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await fetch("/api/dashboard");
        if (!response.ok) {
          throw new Error("Unable to load saved products");
        }

        const data = (await response.json()) as DashboardData & { error?: string };
        setDashboardData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load saved products");
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, []);

  const stats = dashboardData?.stats || {
    totalProducts: 0,
    productsWithImages: 0,
    productsMissingImages: 0,
    todaysUploads: 0,
    uploadsThisMonth: 0,
  };

  return (
    <main className={styles.dashboardShell}>
      <header className={styles.topBar}>
        <div className={styles.topBarInner}>
          <div className={styles.brandBlock}>
            <span>Gopalam Jewels</span>
            <h1>Admin Dashboard</h1>
          </div>
          <AdminButton />

          <nav className={styles.navLinks} aria-label="Primary navigation">
            <Link className={styles.navLink} href="/">
              Scanner
            </Link>
            <Link className={styles.activeNavLink} href="/dashboard">
              Dashboard
            </Link>
            <Link className={styles.navLink} href="/image-catalogue">
              Image Catalogue
            </Link>
            <Link className={styles.navLink} href="/custom-search">
              Custom Search
            </Link>
          </nav>
        </div>
      </header>

      <div className={styles.content}>
        {loading ? <div className={styles.statusBar}>Loading saved products...</div> : null}
        {error ? <div className={styles.errorBox}>{error}</div> : null}

        <DashboardStats stats={stats} />
        <DashboardCharts
          stoneDistribution={dashboardData?.stoneDistribution || []}
          uploadTrend={dashboardData?.uploadTrend || []}
        />
        <DashboardSearch />
        <DashboardTables
          missingImages={dashboardData?.missingImages || []}
          recentUploads={dashboardData?.recentUploads || []}
        />
      </div>
    </main>
  );
}
