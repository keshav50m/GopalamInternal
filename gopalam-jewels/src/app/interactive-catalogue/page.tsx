import Link from "next/link";
import { redirect } from "next/navigation";
import AdminButton from "@/components/AdminButton";
import ChangeTypeButton from "@/components/ChangeTypeButton";
import InteractiveCatalogueAdmin from "@/components/interactiveCatalogue/InteractiveCatalogueAdmin";
import EnquiryNotificationLink from "@/components/interactiveCatalogue/EnquiryNotificationLink";
import styles from "@/components/interactiveCatalogue/InteractiveCatalogue.module.css";
import { getAuthenticatedUser } from "@/lib/auth";

export default async function InteractiveCataloguePage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?returnTo=/interactive-catalogue");
  if (user.role !== "admin") redirect("/scanner");

  return <main className={styles.shell}>
    <header className={styles.topBar}><div className={styles.topBarInner}>
      <div className={styles.brandArea}><ChangeTypeButton /><div><span>Gopalam Jewels</span><h1>Interactive Catalogue</h1></div></div>
      <AdminButton />
      <EnquiryNotificationLink />
      <nav className={styles.navLinks} aria-label="Casting navigation">
        <Link href="/scanner">Scanner</Link><Link href="/dashboard">Dashboard</Link><Link href="/image-catalogue">Image Catalogue</Link><Link href="/custom-search">Custom Search</Link><Link className={styles.activeNav} href="/interactive-catalogue">Interactive Catalogue</Link>
      </nav>
    </div></header>
    <div className={styles.content}><InteractiveCatalogueAdmin /></div>
  </main>;
}
