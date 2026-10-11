import Link from "next/link";
import { redirect } from "next/navigation";
import EnquiriesAdmin from "@/components/interactiveCatalogue/EnquiriesAdmin";
import styles from "@/components/interactiveCatalogue/InteractiveCatalogue.module.css";
import { getAuthenticatedUser } from "@/lib/auth";
export default async function EnquiriesPage() { const user = await getAuthenticatedUser(); if (!user) redirect("/login?returnTo=/interactive-catalogue/enquiries"); if (user.role !== "admin") redirect("/scanner"); return <main className={styles.shell}><header className={styles.topBar}><div className={styles.topBarInner}><div className={styles.brandArea}><div><span>Gopalam Jewels</span><h1>Catalogue Enquiries</h1></div></div><nav className={styles.navLinks}><Link href="/interactive-catalogue">Catalogue Admin</Link><Link className={styles.activeNav} href="/interactive-catalogue/enquiries">Enquiries</Link></nav></div></header><div className={styles.content}><EnquiriesAdmin /></div></main>; }
