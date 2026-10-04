import AdminButton from "@/components/AdminButton";
import ChangeTypeButton from "@/components/ChangeTypeButton";
import GoldProductLookup from "@/components/gold/GoldProductLookup";

export default function GoldScannerPage() {
  return (
    <div className="wrapper">
      <header className="header">
        <div className="header-inner">
          <ChangeTypeButton />
          <img src="/gopalam-jewels-logo.png" className="logo" alt="Gopalam Jewels" />
          <AdminButton />
          <nav style={{ display: "flex", gap: "10px", marginLeft: "auto" }} aria-label="Gold navigation">
            <span style={{ color: "#fff", background: "#9a7a30", border: "1px solid #9a7a30", borderRadius: "6px", padding: "9px 14px", fontSize: "14px", fontWeight: 700 }}>
              Gold Scanner
            </span>
          </nav>
        </div>
      </header>
      <main className="container" style={{ maxWidth: "1600px" }}>
        <div className="card"><GoldProductLookup /></div>
      </main>
    </div>
  );
}

