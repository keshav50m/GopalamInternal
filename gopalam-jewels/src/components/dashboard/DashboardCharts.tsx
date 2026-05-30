import type { ChartPoint } from "./types";
import styles from "./Dashboard.module.css";

type Props = {
  stoneDistribution: ChartPoint[];
  uploadTrend: ChartPoint[];
};

const formatTrendLabel = (label: string) => {
  const date = new Date(`${label}T00:00:00`);
  if (Number.isNaN(date.getTime())) return label;

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
};

function BarList({ points, emptyLabel }: { points: ChartPoint[]; emptyLabel: string }) {
  const maxValue = Math.max(...points.map((point) => point.value), 1);

  if (points.length === 0) {
    return <div className={styles.emptyState}>{emptyLabel}</div>;
  }

  return (
    <div className={styles.barList}>
      {points.map((point) => (
        <div className={styles.barRow} key={point.label}>
          <div className={styles.barLabel}>{point.label}</div>
          <div className={styles.barTrack}>
            <div
              className={styles.barFill}
              style={{ width: `${Math.max((point.value / maxValue) * 100, 8)}%` }}
            />
          </div>
          <div className={styles.barValue}>{point.value}</div>
        </div>
      ))}
    </div>
  );
}

export default function DashboardCharts({ stoneDistribution, uploadTrend }: Props) {
  const maxTrendValue = Math.max(...uploadTrend.map((point) => point.value), 1);

  return (
    <section className={styles.chartGrid}>
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Stone Distribution</h2>
        </div>
        <BarList points={stoneDistribution} emptyLabel="No stone data available" />
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Upload Trend by Date</h2>
        </div>
        {uploadTrend.length === 0 ? (
          <div className={styles.emptyState}>No upload dates available</div>
        ) : (
          <div className={styles.trendChart}>
            {uploadTrend.map((point) => (
              <div className={styles.trendItem} key={point.label}>
                <div className={styles.trendValue}>{point.value}</div>
                <div
                  className={styles.trendBar}
                  style={{ height: `${Math.max((point.value / maxTrendValue) * 160, 18)}px` }}
                />
                <div className={styles.trendLabel}>{formatTrendLabel(point.label)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
