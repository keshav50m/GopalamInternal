import Link from "next/link";
import { redirect } from "next/navigation";
import AdminSettings from "@/components/admin/AdminSettings";
import { getAuthenticatedUser } from "@/lib/auth";
import styles from "@/app/admin/Admin.module.css";

export default async function AdminPage() {
  const user = await getAuthenticatedUser();

  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <span className={styles.brand}>Gopalam Jewels</span>
          <h1>Admin Settings</h1>
          <p>Manage account security and administrative settings.</p>
        </div>
        <Link className={styles.backLink} href="/">Back to Application</Link>
      </header>
      <AdminSettings username={user.username} role={user.role} />
    </main>
  );
}
