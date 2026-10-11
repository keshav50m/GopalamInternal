"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./InteractiveCatalogue.module.css";
export default function EnquiryNotificationLink() { const [count, setCount] = useState(0); useEffect(() => { const load = () => fetch("/api/casting-catalogues/enquiries?countOnly=true").then((r) => r.ok ? r.json() : null).then((d) => { if (d) setCount(d.unread); }).catch(() => {}); load(); const timer = window.setInterval(load, 45_000); return () => window.clearInterval(timer); }, []); return <Link className={styles.enquiryNotification} href="/interactive-catalogue/enquiries">Enquiries 🔔 {count}</Link>; }
