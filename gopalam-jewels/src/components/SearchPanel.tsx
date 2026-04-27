"use client";
import { useState, useEffect, useRef } from "react";

interface Props {
  products: any[];
}

export default function SearchPanel({ products }: Props) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<any | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [cart, setCart] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input for barcode scanner
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Barcode scanner support — auto search on Enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleSearch = () => {
    if (!query.trim()) return;
    const found = products.find((p) =>
      Object.values(p).some((v) =>
        String(v).toLowerCase().includes(query.toLowerCase())
      )
    );
    if (found) {
      setResult(found);
      setNotFound(false);
    } else {
      setResult(null);
      setNotFound(true);
    }
  };

  const addToCart = (product: any) => {
    if (!cart.find((p) => JSON.stringify(p) === JSON.stringify(product))) {
      setCart([...cart, product]);
    }
  };

  const removeFromCart = (index: number) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">

      {/* Search Box */}
      <div className="card">
        <h2 className="text-xl font-bold mb-4" style={{ color: "var(--gold-dark)" }}>
          🔍 Product Lookup
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Enter a serial number manually or scan a barcode — results appear instantly.
        </p>
        <div className="flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Serial number or scan barcode here..."
            className="flex-1 border-2 rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors"
            style={{ borderColor: "var(--gold)", fontFamily: "Georgia, serif" }}
          />
          <button onClick={handleSearch} className="btn-gold px-6 rounded-xl">
            Search
          </button>
          <button
            onClick={() => { setQuery(""); setResult(null); setNotFound(false); inputRef.current?.focus(); }}
            className="px-4 py-2 rounded-xl border-2 text-gray-500 hover:border-red-300 transition-colors text-sm"
          >
            Clear
          </button>
        </div>

        {/* No data warning */}
        {products.length === 0 && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
            ⚠️ No product data loaded yet. Please go to <strong>Admin Panel</strong> and upload your Excel file first.
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className="card border-2" style={{ borderColor: "var(--gold)" }}>
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-lg font-bold" style={{ color: "var(--gold-dark)" }}>
              ✅ Product Found
            </h3>
            <button onClick={() => addToCart(result)} className="btn-gold text-sm">
              + Add to List
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(result).map(([key, value]) => (
              <div key={key} className="flex flex-col bg-gray-50 rounded-lg p-3">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{key}</span>
                <span className="text-sm font-medium text-gray-800 mt-1">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Not Found */}
      {notFound && (
        <div className="card border border-red-200 bg-red-50">
          <p className="text-red-600 font-medium">❌ No product found for "<strong>{query}</strong>"</p>
          <p className="text-sm text-red-400 mt-1">Please check the serial number and try again.</p>
        </div>
      )}

      {/* Cart */}
      {cart.length > 0 && (
        <div className="card">
          <h3 className="font-bold text-gray-700 mb-3">
            🛒 Selected Products ({cart.length})
          </h3>
          <div className="space-y-3">
            {cart.map((item, i) => (
              <div key={i} className="flex justify-between items-center bg-gray-50 rounded-lg p-3">
                <div className="text-sm text-gray-700">
                  {Object.entries(item).slice(0, 3).map(([k, v]) => (
                    <span key={k} className="mr-3"><strong>{k}:</strong> {String(v)}</span>
                  ))}
                </div>
                <button
                  onClick={() => removeFromCart(i)}
                  className="text-red-400 hover:text-red-600 text-xs ml-2"
                >
                  ✕ Remove
                </button>
              </div>
            ))}
          </div>
          <button className="btn-gold mt-4 w-full text-sm rounded-xl py-3">
            📄 Export as PDF
          </button>
        </div>
      )}
    </div>
  );
}