"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Course = { id: string; slug: string; title: string; summary?: string; level?: string };

export default function CatalogPage() {
  const [items, setItems] = useState<Course[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hint = !process.env.NEXT_PUBLIC_API_BASE ? "Defina NEXT_PUBLIC_API_BASE no Netlify para apontar a API." : null;

  useEffect(() => {
    let alive = true;
    (async () => {
      const { status, body } = await api("/api/catalog");
      if (!alive) return;
      if (status === 200 && Array.isArray(body?.items)) setItems(body.items);
      else setErr(JSON.stringify({ status, body }));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div>
      <h1>Catálogo</h1>
      {hint && <p style={{ color:"#996a00", background:"#fff7d6", padding:"6px 8px", border:"1px solid #ffe08a", borderRadius:6 }}>{hint}</p>}
      {loading && <p>Carregando...</p>}
      {err && <pre style={{ color: "crimson" }}>{err}</pre>}
      <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, padding: 0 }}>
        {items.map(c => (
          <li key={c.id} style={{ listStyle: "none", border: "1px solid #eee", padding: 12, borderRadius: 8 }}>
            <h3 style={{ margin: "0 0 6px 0" }}>{c.title}</h3>
            {c.summary && <p style={{ margin: "0 0 8px 0", color: "#555" }}>{c.summary}</p>}
            <Link href={`/course/${encodeURIComponent(c.id)}`}>Ver curso</Link>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 16 }}>
        <Link href="/health">/health</Link>
      </div>
    </div>
  );
}
