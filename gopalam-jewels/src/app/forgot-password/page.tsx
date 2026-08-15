"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import styles from "@/app/auth.module.css";

export default function ForgotPasswordPage() {
  const [username, setUsername] = useState("admin");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await response.json();
      if (!response.ok) setError(data.error || "Unable to reset password right now.");
      else setMessage(data.message);
    } catch {
      setError("Unable to reset password right now.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.shell}>
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.brand}>GOPALAM GEMS &amp; JEWELLERY</div>
        <h1 className={styles.title}>Forgot Password</h1>
        <p className={styles.description}>A new secure password will be emailed to the address registered for this account.</p>
        <label className={styles.field}>
          Username
          <input className={styles.input} autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {message ? <p className={styles.success}>{message}</p> : null}
        <button className={styles.button} disabled={submitting} type="submit">
          {submitting ? "Sending..." : "Send New Password"}
        </button>
        <Link className={styles.link} href="/login">Back to Login</Link>
      </form>
    </main>
  );
}
