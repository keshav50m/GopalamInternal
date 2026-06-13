"use client";

type Props = {
  onSelect: (type: "casting" | "polki") => void;
};

export default function JewellerySelector({ onSelect }: Props) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#f5f3ef",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1>Select Jewellery Type</h1>

        <div
          style={{
            display: "flex",
            gap: "20px",
            marginTop: "30px",
          }}
        >
          <button
            onClick={() => onSelect("casting")}
            style={{
              padding: "20px 40px",
              fontSize: "18px",
              cursor: "pointer",
            }}
          >
            Casting Jewellery
          </button>

          <button
            onClick={() => onSelect("polki")}
            style={{
              padding: "20px 40px",
              fontSize: "18px",
              cursor: "pointer",
            }}
          >
            Polki Jewellery
          </button>
        </div>
      </div>
    </div>
  );
}