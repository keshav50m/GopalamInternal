"use client";

import { useState } from "react";
import ChangePasswordForm from "@/components/admin/ChangePasswordForm";
import styles from "@/app/admin/Admin.module.css";

type AdminSettingsProps = {
  username: string;
  role: string;
};

export default function AdminSettings({ username, role }: AdminSettingsProps) {
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const logout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  };

  return (
    <div className={styles.settingsGrid}>
      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <span className={styles.sectionIcon} aria-hidden="true">👤</span>
          <div><h2>Account</h2><p>Your authenticated account details.</p></div>
        </div>
        <dl className={styles.details}>
          <div><dt>Username</dt><dd>{username}</dd></div>
          <div><dt>Role</dt><dd>{role === "admin" ? "Administrator" : role}</dd></div>
        </dl>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <span className={styles.sectionIcon} aria-hidden="true">🔐</span>
          <div><h2>Security</h2><p>Update the password used to access your account.</p></div>
        </div>
        {!showChangePassword ? (
          <button className={styles.primaryButton} onClick={() => setShowChangePassword(true)}>Change Password</button>
        ) : (
          <div className={styles.formPanel}>
            <ChangePasswordForm />
            <button className={styles.secondaryButton} type="button" onClick={() => setShowChangePassword(false)}>Cancel</button>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <span className={styles.sectionIcon} aria-hidden="true">↪</span>
          <div><h2>Session</h2><p>End your current authenticated session.</p></div>
        </div>
        <button className={styles.logoutButton} disabled={loggingOut} onClick={logout}>{loggingOut ? "Logging out..." : "Logout"}</button>
      </section>
    </div>
  );
}
