import styles from "@/app/auth.module.css";
import ChangePasswordForm from "@/components/admin/ChangePasswordForm";

export default function ChangePasswordPage() {
  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.brand}>GOPALAM GEMS &amp; JEWELLERY</div>
        <h1 className={styles.title}>Change Password</h1>
        <ChangePasswordForm />
      </div>
    </main>
  );
}
