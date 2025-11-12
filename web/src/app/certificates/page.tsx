"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Cert = {
  course_id: string;
  pdf_url: string;
  issued_at: string;
  serial?: string | null;
  hash?: string | null;
};

export default function CertificatesPage() {
  const [items, setItems] = useState<Cert[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { status, body } = await api(`/api/certificates?unique=1`);
      if (!alive) return;
      if (status === 200 && Array.isArray(body?.certificates)) {
        setItems(body.certificates);
      } else {
        setErr(JSON.stringify({ status, body }));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

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
