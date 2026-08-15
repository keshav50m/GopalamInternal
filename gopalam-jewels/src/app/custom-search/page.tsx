import Link from "next/link";
import CustomSearch from "@/components/customSearch/CustomSearch";
import styles from "@/components/customSearch/CustomSearch.module.css";
import AdminButton from "@/components/AdminButton";

export default function CustomSearchPage() {
  return (
    <main className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.topBarInner}>
          <div className={styles.brandBlock}>
            <span>Gopalam Jewels</span>
            <h1>Custom Search</h1>
          </div>
          <AdminButton />

          <nav className={styles.navLinks} aria-label="Primary navigation">
            <Link className={styles.navLink} href="/">
              Scanner
            </Link>
            <Link className={styles.navLink} href="/dashboard">
              Dashboard
            </Link>
            <Link className={styles.navLink} href="/image-catalogue">
              Image Catalogue
            </Link>
            <Link className={styles.activeNavLink} href="/custom-search">
              Custom Search
            </Link>
          </nav>
        </div>
      </header>

      <div className={styles.content}>
        <CustomSearch />
      </div>
    </main>
  );
}
