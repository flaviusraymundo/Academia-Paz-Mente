"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { usePageRead } from "../../../hooks/usePageRead";

export default function TextItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const qs = useSearchParams();
  const courseId = qs.get("courseId") || "";
  const moduleId = qs.get("moduleId") || "";
  const { jwt, authReady, isAuthenticated } = useRequireAuth();

  const [reading, setReading] = useState(true);
  const [lastBeat, setLastBeat] = useState<string | null>(null);

  // Flags para sincronização inteligente:
  // - wasAuthedRef: detectar transição real de login (false -> true)
  // - authPausedRef: lembrar se a última pausa foi automática por falta de auth
  // - manualPausedRef: o usuário pausou manualmente (apenas em DEBUG)
  const wasAuthedRef = useRef<boolean>(isAuthenticated);
  const authPausedRef = useRef<boolean>(false);
  const manualPausedRef = useRef<boolean>(false);

  const DEBUG = process.env.NEXT_PUBLIC_DEBUG === "1";

  usePageRead({
    enabled: !!(authReady && isAuthenticated && reading && courseId && moduleId && itemId),
    jwt,
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

  // 1) Sincroniza com transições de autenticação:
  // - Perdeu JWT: pausa e marca pausa por auth.
  // - Ganhou JWT (transição real de login): retoma apenas se a pausa anterior foi por auth
  //   e não houver pausa manual.
  // - Refresh (true -> true): não interfere.
  useEffect(() => {
    if (!authReady) return;

    const nowAuthed = isAuthenticated;
    const wasAuthed = wasAuthedRef.current;

    if (!nowAuthed) {
      if (reading) {
        setReading(false);
        authPausedRef.current = true;
      }
    } else if (!wasAuthed && nowAuthed) {
      if (!reading && authPausedRef.current && !manualPausedRef.current) {
        setReading(true);
      }
      authPausedRef.current = false;
    }

    wasAuthedRef.current = nowAuthed;
  }, [authReady, isAuthenticated, reading]);

  // 2) Sincroniza com visibilidade da aba (auto-pause quando a aba fica oculta).
  // Não sobrescreve pausa manual.
  useEffect(() => {
    if (!authReady || !isAuthenticated) return;

    const applyVisibility = () => {
      if (manualPausedRef.current) return;
      const visible = !document.hidden;
      setReading(visible);
    };

    // Ajuste imediato ao montar
    applyVisibility();

    const onVis = () => applyVisibility();
    const onFocus = () => applyVisibility();
    const onBlur = () => applyVisibility();

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [authReady, isAuthenticated]);

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

      {authReady && !isAuthenticated && (
        <div data-testid="text-auth-warning" style={{ fontSize: 14 }}>
          Faça login para registrar leitura.
        </div>
      )}

      <article
        style={{ padding: 12, border: "1px solid #eee", borderRadius: 8, background: "#fff" }}
      >
        <h3>Documento</h3>
        <p style={{ color: "#555", marginTop: 0 }}>
          O tempo de leitura é registrado automaticamente enquanto você estiver autenticado e com
          esta aba visível.
        </p>
        {!DEBUG && (
          <p style={{ color: "#555", marginTop: 0 }}>
            Mantenha a aba ativa para que a telemetria contabilize o tempo corretamente.
          </p>
        )}
        {DEBUG && (
          <p style={{ color: "#555", marginTop: 0 }}>
            Debug ativo: você pode pausar/retomar manualmente usando o botão abaixo.
          </p>
        )}
      </article>

      {DEBUG && (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() =>
              setReading((prev) => {
                const next = !prev;
                manualPausedRef.current = !next;
                if (next) {
                  authPausedRef.current = false;
                }
                return next;
              })
            }
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
          {lastBeat && (
            <span data-testid="text-last-beat" style={{ fontSize: 12, color: "#666" }}>
              lastBeat: {lastBeat}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
