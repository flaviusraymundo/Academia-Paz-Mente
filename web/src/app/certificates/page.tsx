"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";

type Cert = {
  course_id: string;
  pdf_url: string;
  issued_at: string;
  serial?: string | null;
  hash?: string | null;
};

export default function CertificatesPage() {
  const { jwt, ready } = useAuth();
  const [items, setItems] = useState<Cert[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    if (!jwt) {
      setItems([]);
      setErr(null);
      setLoading(false);
      return;
    }

    let alive = true;
    (async () => {
      setLoading(true);
      const { status, body } = await api(`/api/certificates?unique=1`, { jwt });
      if (!alive) return;
      if (status === 200 && Array.isArray(body?.certificates)) {
        setItems(body.certificates);
        setErr(null);
      } else {
        setItems([]);
        setErr(JSON.stringify({ status, body }));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [jwt, ready]);

  return (
    <div>
      <h1>Certificados</h1>
      {loading && <p>Carregando...</p>}
      {err && <pre style={{ color: "crimson" }}>{err}</pre>}
      {!loading && items.length === 0 && <p>Nenhum certificado encontrado.</p>}
      <ul style={{ paddingLeft: 16 }}>
        {items.map((c, idx) => (
          <li key={`${c.course_id}-${idx}`} style={{ marginBottom: 10 }}>
            <div>Course ID: <code>{c.course_id}</code></div>
            <div>Emitido em: {new Date(c.issued_at).toLocaleString()}</div>
            <div>
              PDF:{" "}
              <a href={c.pdf_url} target="_blank" rel="noreferrer">
                abrir
              </a>
            </div>
            {c.serial ? <div>Serial: <code>{c.serial}</code></div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
