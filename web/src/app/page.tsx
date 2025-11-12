"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";

interface CatalogItem {
  id: string;
  title?: string;
  summary?: string;
}

export default function CatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);
  const [jwt, setJwt] = useState("");

  useEffect(() => {
    try {
      const t = localStorage.getItem("jwt") || "";
      setJwt(t);
    } catch {}
  }, []);

  useEffect(() => {
    async function load() {
      if (!jwt) return;
      setLoading(true);
      setError(null);
      const { status, body } = await apiGet<{ items: CatalogItem[] }>("/api/catalog", jwt);
      if (status === 200 && body.items) {
        setItems(body.items);
      } else {
        setError({ status, body });
      }
      setLoading(false);
    }
    load();
  }, [jwt]);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE;

  return (
    <div>
      <h2>Catálogo</h2>
      {!apiBase && (
        <div style={{ background: "#fff3cd", border: "1px solid #ffe08a", padding: 12, borderRadius: 8, marginBottom: 12 }}>
          Defina NEXT_PUBLIC_API_BASE no Netlify para apontar a API.
        </div>
      )}
      {!jwt && (
        <div style={{ background: "#e7f0ff", border: "1px solid #c6dafd", padding: 12, borderRadius: 8, marginBottom: 12 }}>
          Entre primeiro (botão “Entrar” no topo) para carregar o catálogo.
        </div>
      )}
      {loading && <div>Carregando...</div>}
      {error && (
        <pre style={{ background: "#fff", padding: 12, borderRadius: 8, border: "1px solid #eee", maxWidth: 600 }}>
{JSON.stringify(error, null, 2)}
        </pre>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16 }}>
        {items.map(c => (
          <div key={c.id} style={{ background:"#fff", border:"1px solid #e2e2e2", padding:12, borderRadius:10 }}>
            <strong>{c.title || c.id}</strong>
            {c.summary && <div style={{ fontSize:12, color:"#555", marginTop:6 }}>{c.summary}</div>}
            <div style={{ fontSize:11, color:"#666", marginTop:8 }}>courseId: {c.id}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
