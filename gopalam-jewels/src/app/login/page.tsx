"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import styles from "@/app/auth.module.css";

function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Invalid username or password.");
        return;
      }
      localStorage.removeItem("jewelleryType");
      window.location.href = "/?select=1";
    } catch {
      setError("Unable to log in right now.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className={styles.card} onSubmit={submit}>
      <div className={styles.brand}>GOPALAM GEMS &amp; JEWELLERY</div>
      <h1 className={styles.title}>Login</h1>
      <p className={styles.description}>Sign in to access the product management system.</p>
      <label className={styles.field}>
        Username
        <input className={styles.input} autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label className={styles.field}>
        Password
        <input className={styles.input} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button className={styles.button} disabled={submitting} type="submit">
        {submitting ? "Signing in..." : "Login"}
      </button>
      <Link className={styles.link} href="/forgot-password">Forgot Password</Link>
    </form>
  );
}

export default function LoginPage() {
  return <main className={styles.shell}><LoginForm /></main>;
}
