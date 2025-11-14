"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import api from "../../../lib/api";
import { Card } from "../../../components/ui/Card";
import { Badge } from "../../../components/ui/Badge";
import { Skeleton } from "../../../components/ui/Skeleton";
import { CertificateVerifyRawSchema } from "../../../schemas/certificates";

export default function CertificateVerifyPage() {
  const { serial } = useParams<{ serial: string }>();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const s = String(serial ?? "").trim();
        if (!s) {
          setErr(JSON.stringify({ error: "serial_required" }));
          setLoading(false);
          return;
        }
        const { status, body } = await api(`/api/certificates/verify/${encodeURIComponent(s)}`);
        if (!alive) return;
        if (status === 200 && body && typeof body === "object") {
          const parsed = CertificateVerifyRawSchema.safeParse(body);
          if (parsed.success) {
            const normalized = parsed.data as any;
            const valid = Boolean(normalized?.serial || normalized?.url || normalized?.courseId);
            setData({ ...normalized, valid });
            setErr(null);
          } else {
            setData(null);
            setErr(JSON.stringify({ status, validationError: parsed.error.flatten() }));
          }
        } else {
          setData(null);
          setErr(JSON.stringify({ status, body }));
        }
      } catch (e: any) {
        if (!alive) return;
        setData(null);
        setErr(JSON.stringify({ error: String(e) }));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [serial]);

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Verificar Certificado</h1>
      <div style={{ fontSize: 12, color: "#666" }}>
        serial: <code>{serial}</code>
      </div>

      {loading && (
        <div style={{ display: "grid", gap: 12 }} data-testid="certificate-verify-loading">
          <Card>
            <Skeleton h={16} w="50%" />
            <Skeleton h={12} w="90%" />
          </Card>
        </div>
      )}

      {err && !loading && (
        <Card
          style={{ borderColor: "#f2c2c2", background: "#fff6f6", color: "#842029" }}
          data-testid="certificate-verify-error"
        >
          <strong>Erro na verificação</strong>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>{err}</pre>
        </Card>
      )}

      {!err && !loading && data && (
        <Card style={{ gap: 8 }} data-testid="certificate-verify-result">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong>Resultado</strong>
            {"valid" in data && (
              <Badge tone={data.valid ? "success" : "warn"}>{data.valid ? "válido" : "inválido"}</Badge>
            )}
          </div>
          <div style={{ fontSize: 13 }}>
            {data.courseId && (
              <>
                courseId: <code>{data.courseId}</code>
                <br />
              </>
            )}
            {data.issuedAt && (
              <>
                emitido em: <code>{new Date(data.issuedAt).toLocaleString()}</code>
                <br />
              </>
            )}
          </div>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "#555" }}>Detalhes</summary>
            <pre
              style={{
                margin: 0,
                fontSize: 12,
                background: "#f8f8fa",
                padding: 8,
                borderRadius: 8,
                border: "1px solid #eee",
              }}
            >
{JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </Card>
      )}
    </div>
  );
}
