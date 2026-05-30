import type { DashboardStats as DashboardStatsType } from "./types";
import styles from "./Dashboard.module.css";

type Props = {
  stats: DashboardStatsType;
};

const statCards = [
  { key: "totalProducts", label: "Total Products" },
  { key: "productsWithImages", label: "Products With Images" },
  { key: "productsMissingImages", label: "Products Missing Images" },
  { key: "todaysUploads", label: "Today's Uploads" },
  { key: "uploadsThisMonth", label: "Uploads This Month" },
] as const;

export default function DashboardStats({ stats }: Props) {
  return (
    <section className={styles.statsGrid} aria-label="Dashboard stats">
      {statCards.map((card) => (
        <div className={styles.statCard} key={card.key}>
          <span>{card.label}</span>
          <strong>{stats[card.key]}</strong>
        </div>
      ))}
    </section>
  );
}
