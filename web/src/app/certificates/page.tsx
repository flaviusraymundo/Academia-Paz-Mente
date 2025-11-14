"use client";

import type React from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Skeleton";
import { CertificateListSchema, type Certificate } from "../../schemas/certificates";

export default function CertificatesPage() {
  const { jwt, ready } = useRequireAuth();
  const [items, setItems] = useState<Certificate[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      setErr(null);
      const { status, body } = await api(`/api/certificates?unique=1`, { jwt });
      if (!alive) return;
      if (status === 200 && typeof body === "object") {
        const parsed = CertificateListSchema.safeParse(body);
        if (parsed.success) {
          setItems(parsed.data.certificates ?? []);
          setErr(null);
        } else {
          setItems([]);
          setErr(JSON.stringify({ status, validationError: parsed.error.flatten() }));
        }
      } else {
        setItems([]);
        setErr(JSON.stringify({ status, body }));
      }
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [jwt, ready]);

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Certificados</h1>

      {!ready && (
        <div style={{ display: "grid", gap: 12 }}>
          <Card>
            <Skeleton h={18} w="40%" />
            <Skeleton h={12} w="80%" />
          </Card>
          <Card>
            <Skeleton h={18} w="50%" />
            <Skeleton h={12} w="70%" />
          </Card>
        </div>
      )}

      {ready && !jwt && (
        <Card>
          <strong>Não autenticado</strong>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-soft)" }}>
            Clique em “Entrar” (topo) para visualizar seus certificados.
          </p>
        </Card>
      )}

      {ready && jwt && loading && (
        <div style={{ display: "grid", gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <Skeleton h={16} w="60%" />
              <Skeleton h={12} w="90%" />
            </Card>
          ))}
        </div>
      )}

      {ready && jwt && err && !loading && (
        <Card style={{ borderColor: "#f2c2c2", background: "#fff6f6", color: "#842029" }}>
          <strong>Erro ao carregar certificados</strong>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>{err}</pre>
        </Card>
      )}

      {ready && jwt && !err && !loading && items.length === 0 && (
        <p style={{ fontSize: 14, color: "#555" }}>Nenhum certificado encontrado.</p>
      )}

      {ready && jwt && !err && !loading && items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((c, index) => (
            <Card key={c.serial ?? c.id ?? `${c.courseId ?? "unknown"}-${index}`} style={{ gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong>Serial:</strong> <code>{c.serial ?? "-"}</code>
                  {c.status && <Badge tone={c.status === "valid" ? "success" : "neutral"}>{c.status}</Badge>}
                  {c.issuedAt && <Badge tone="info">{new Date(c.issuedAt).toLocaleDateString()}</Badge>}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {c.serial ? (
                    <Link
                      href={`/certificate/${encodeURIComponent(c.serial)}`}
                      style={linkBtn}
                      data-testid={`certificate-verify-${c.serial}`}
                    >
                      Verificar
                    </Link>
                  ) : (
                    <span style={{ ...linkBtn, opacity: 0.6, pointerEvents: "none" as const }}>Sem serial</span>
                  )}
                  {c.url ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      style={primaryBtn}
                      data-testid={`certificate-download-${c.serial ?? index}`}
                    >
                      Baixar PDF
                    </a>
                  ) : (
                    <span style={{ ...linkBtn, opacity: 0.6, pointerEvents: "none" as const }}>Sem PDF</span>
                  )}
                </div>
              </div>
              {c.courseId && (
                <div style={{ fontSize: 12, color: "#666" }}>
                  courseId: <code>{c.courseId}</code>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  display: "inline-block",
  padding: "6px 10px",
  borderRadius: 6,
  background: "#f5f5f7",
  border: "1px solid #ccc",
  textDecoration: "none",
  color: "#222",
  fontSize: 13,
};

const primaryBtn: React.CSSProperties = {
  ...linkBtn,
  background: "var(--color-primary)",
  borderColor: "var(--color-primary)",
  color: "#fff",
};
