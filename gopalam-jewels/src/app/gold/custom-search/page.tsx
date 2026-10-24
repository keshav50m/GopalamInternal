import Link from "next/link";
import AdminButton from "@/components/AdminButton";
import ChangeTypeButton from "@/components/ChangeTypeButton";
import GoldCustomSearch from "@/components/gold/GoldCustomSearch";
import styles from "@/components/customSearch/CustomSearch.module.css";

export default function GoldCustomSearchPage() {
  return <main className={styles.shell}>
    <header className={styles.topBar}><div className={styles.topBarInner}>
      <div className={styles.brandArea}><ChangeTypeButton /><div className={styles.brandBlock}><span>Gopalam Jewels</span><h1>Gold Custom Search</h1></div></div>
      <AdminButton /><nav className={styles.navLinks} aria-label="Gold navigation">
        <Link className={styles.navLink} href="/gold/scanner">Gold Scanner</Link>
        <Link className={styles.navLink} href="/gold/dashboard">Dashboard</Link>
        <Link className={styles.activeNavLink} href="/gold/custom-search" aria-current="page">Custom Search</Link>
      </nav>
    </div></header>
    <div className={styles.content}><GoldCustomSearch /></div>
  </main>;
}
