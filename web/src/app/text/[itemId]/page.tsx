"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useAuth } from "../../../contexts/AuthContext";
import { usePageRead } from "../../../hooks/usePageRead";

export default function TextItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const qs = useSearchParams();
  const courseId = qs.get("courseId") || "";
  const moduleId = qs.get("moduleId") || "";
  const { jwt, ready } = useAuth();

  const [reading, setReading] = useState(true);
  const [lastBeat, setLastBeat] = useState<string | null>(null);

  const DEBUG = process.env.NEXT_PUBLIC_DEBUG === "1";

  usePageRead({
    enabled: !!(ready && jwt && reading && courseId && moduleId && itemId),
    jwt: jwt || "",
    courseId,
    moduleId,
    itemId,
    intervalMs: 15000,
    onBeat: (at) => {
      if (DEBUG) setLastBeat(new Date(at).toISOString());
    },
  });

  const infoRows = useMemo(
    () => [
      { k: "itemId", v: itemId },
      { k: "courseId", v: courseId || "-" },
      { k: "moduleId", v: moduleId || "-" },
    ],
    [itemId, courseId, moduleId]
  );

  useEffect(() => {
    if (!ready) return;
    if (!jwt) {
      setReading(false);
    } else {
      setReading(true);
    }
  }, [ready, jwt]);

  return (
    <div
      data-testid="text-item-page"
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <h1 style={{ margin: 0, fontSize: 24 }}>Texto</h1>

      <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
        {infoRows.map((r) => (
          <div key={r.k}>
            <strong>{r.k}:</strong>{" "}
            <code style={{ background: "#f2f2f4", padding: "2px 6px", borderRadius: 6 }}>{r.v}</code>
          </div>
        ))}
      </div>

      {!jwt && ready && (
        <div data-testid="text-auth-warning" style={{ fontSize: 14 }}>
          Faça login para registrar leitura.
        </div>
      )}

      <article
        style={{ padding: 12, border: "1px solid #eee", borderRadius: 8, background: "#fff" }}
      >
        <h3>Documento</h3>
        <p style={{ color: "#555", marginTop: 0 }}>
          Exemplo de página de texto. O tempo de leitura é enviado a cada 15s para analytics
          enquanto a leitura estiver ativa.
        </p>
        <p>
          Você pode pausar/retomar a leitura usando o botão abaixo. Se entrar sem login e depois
          autenticar, a leitura retoma automaticamente.
        </p>
      </article>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => setReading((v) => !v)}
          data-testid="toggle-reading"
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: reading ? "var(--color-primary,#3758f9)" : "#ccc",
            color: "#fff",
            border: "none",
            cursor: "pointer",
          }}
        >
          {reading ? "Pausar leitura" : "Retomar leitura"}
        </button>
        {DEBUG && lastBeat && (
          <span data-testid="text-last-beat" style={{ fontSize: 12, color: "#666" }}>
            lastBeat: {lastBeat}
          </span>
        )}
      </div>
    </div>
  );
}
