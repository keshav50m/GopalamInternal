import Link from "next/link";
import CustomSearch from "@/components/polki/customSearch/CustomSearch";
import styles from "@/components/polki/customSearch/CustomSearch.module.css";
import AdminButton from "@/components/AdminButton";
import ChangeTypeButton from "@/components/ChangeTypeButton";

export default function CustomSearchPage() {
  return (
    <main className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.topBarInner}>
          <div className={styles.brandArea}>
            <ChangeTypeButton />
            <div className={styles.brandBlock}>
              <span>Gopalam Jewels</span>
              <h1>Custom Search</h1>
            </div>
          </div>
          <AdminButton />

          <nav className={styles.navLinks} aria-label="Primary navigation">
            <Link className={styles.navLink} href="/polki/scanner">
              Scanner
            </Link>
            <Link className={styles.navLink} href="/polki/dashboard">
              Dashboard
            </Link>
            <Link className={styles.navLink} href="/polki/image-catalogue">
              Image Catalogue
            </Link>
            <Link className={styles.activeNavLink} href="/polki/custom-search">
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
