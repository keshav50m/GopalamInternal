import type { SavedProduct } from "./types";
import { formatDisplayDate, getBarcode, getStoneName } from "./dashboardUtils";
import styles from "./Dashboard.module.css";

type Props = {
  missingImages: SavedProduct[];
  recentUploads: SavedProduct[];
};

function ProductRows({ products, emptyLabel }: { products: SavedProduct[]; emptyLabel: string }) {
  if (products.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={5} className={styles.tableEmpty}>
            {emptyLabel}
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody>
      {products.map((product, index) => (
        <tr key={`${getBarcode(product)}-${index}`}>
          <td>{getBarcode(product) || "Not available"}</td>
          <td>{product.data?.ITEMNO || "Not available"}</td>
          <td>{getStoneName(product)}</td>
          <td>{product.data?.["TAG PRICE"] || "Not available"}</td>
          <td>{formatDisplayDate(product)}</td>
        </tr>
      ))}
    </tbody>
  );
}

export default function DashboardTables({ missingImages, recentUploads }: Props) {
  return (
    <section className={styles.tableGrid}>
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Missing Images Table</h2>
          <span>{missingImages.length} products</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.dashboardTable}>
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Item No</th>
                <th>Stone</th>
                <th>Price</th>
                <th>Updated</th>
              </tr>
            </thead>
            <ProductRows
              products={missingImages.slice(0, 12)}
              emptyLabel="All products currently have images"
            />
          </table>
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Recent Uploads Table</h2>
          <span>Latest {Math.min(recentUploads.length, 12)}</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.dashboardTable}>
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Item No</th>
                <th>Stone</th>
                <th>Price</th>
                <th>Updated</th>
              </tr>
            </thead>
            <ProductRows
              products={recentUploads.slice(0, 12)}
              emptyLabel="No recent uploads available"
            />
          </table>
        </div>
      </div>
    </section>
  );
}
