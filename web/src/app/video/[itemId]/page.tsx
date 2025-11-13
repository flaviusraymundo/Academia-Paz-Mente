"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useAuth } from "../../../contexts/AuthContext";
import { PlaybackTokenResponseSchema } from "../../../schemas/video";
import { useVideoHeartbeat } from "../../../hooks/useVideoHeartbeat";

export default function VideoItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const qs = useSearchParams();
  const courseId = qs.get("courseId") || "";
  const moduleId = qs.get("moduleId") || "";
  const { jwt, ready } = useAuth();

  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!jwt) {
      setToken(null);
      setErr(null);
      setStatus(null);
      setPlaying(false);
      return;
    }
    let alive = true;
    (async () => {
      setErr(null);
      setStatus(null);
      try {
        const { status, body } = await api(`/api/video/${encodeURIComponent(itemId)}/playback-token`, {
          method: "POST",
          jwt,
        });
        if (!alive) return;
        if (status === 200 && typeof body === "object") {
          const parsed = PlaybackTokenResponseSchema.safeParse(body);
          if (parsed.success) {
            setToken(parsed.data.token ?? null);
            setErr(null);
          } else {
            setToken(null);
            setErr(JSON.stringify({ status, validationError: parsed.error.flatten() }));
          }
        } else {
          setToken(null);
          setErr(JSON.stringify({ status, body }));
        }
      } catch (e: any) {
        if (!alive) return;
        setToken(null);
        setErr(JSON.stringify({ error: String(e) }));
      }
    })();
    return () => { alive = false; };
  }, [itemId, jwt, ready]);

  const DEBUG = process.env.NEXT_PUBLIC_DEBUG === "1";

  // Heartbeat isolado, ativado somente quando "playing" e com DEBUG
  useVideoHeartbeat({
    enabled: !!(DEBUG && playing && jwt && itemId),
    jwt: jwt || "",
    courseId,
    moduleId,
    itemId,
    intervalMs: 15000,
  });

  function onPlay() {
    setPlaying(true);
  }
  function onPause() {
    setPlaying(false);
  }

  return (
    <div>
      <h1>Vídeo</h1>
      {err && <pre style={{ color: "crimson" }}>{err}</pre>}
      <p><strong>itemId:</strong> <code>{itemId}</code></p>
      <p><strong>courseId:</strong> <code>{courseId || "-"}</code></p>
      <p><strong>moduleId:</strong> <code>{moduleId || "-"}</code></p>
      {/* Player real pode ser integrado depois (Mux). Mantemos controles de debug. */}
      {DEBUG ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p><strong>playback token:</strong> <code>{token || "-"}</code></p>
          <div style={{ display: "flex", gap: 8 }}>
            {!playing ? (
              <button onClick={onPlay} style={{ padding: "8px 12px" }}>Simular Play (inicia heartbeat)</button>
            ) : (
              <button onClick={onPause} style={{ padding: "8px 12px" }}>Simular Pause (para heartbeat)</button>
            )}
          </div>
          {/* status mantido se quiser depurar respostas de heartbeat no futuro */}
          {status && <pre style={{ marginTop: 12 }}>{JSON.stringify(status, null, 2)}</pre>}
          <p style={{ color:"#666" }}>Debug: token e heartbeat isolados do player.</p>
        </div>
      ) : (
        <p style={{ color:"#666" }}>O player será integrado em breve.</p>
      )}
    </div>
  );
}
