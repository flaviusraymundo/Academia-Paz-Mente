"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useAuth } from "../../../contexts/AuthContext";
import { PlaybackTokenResponseSchema } from "../../../schemas/video";
import { useVideoHeartbeat } from "../../../hooks/useVideoHeartbeat";
import { VideoPlayer } from "../../../components/video/VideoPlayer";
import { ModuleItemsResponseSchema } from "../../../schemas/modules";

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
  const [playbackId, setPlaybackId] = useState<string | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!jwt) {
      setToken(null);
      setErr(null);
      setStatus(null);
      setPlaying(false);
      setPlaybackId(null);
      return;
    }
    let alive = true;
    const ac = new AbortController();
    (async () => {
      setErr(null);
      setStatus(null);
      try {
        const { status, body } = await api(`/api/video/${encodeURIComponent(itemId)}/playback-token`, {
          method: "POST",
          jwt,
          signal: ac.signal,
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
    return () => {
      alive = false;
      ac.abort();
    };
  }, [itemId, jwt, ready]);

  useEffect(() => {
    if (!ready || !jwt) return;
    if (!courseId) return;
    let alive = true;
    (async () => {
      setLoadingMeta(true);
      setMetaErr(null);
      try {
        const qs2 = new URLSearchParams({ courseId });
        const { status, body } = await api(`/api/me/items?${qs2.toString()}`, { jwt });
        if (!alive) return;
        if (status === 200 && typeof body === "object") {
          const parsed = ModuleItemsResponseSchema.safeParse(body);
          if (parsed.success) {
            const mods = parsed.data.items || [];
            let found: any = null;
            for (const m of mods) {
              const hit = (m.items || []).find((it: any) => it.item_id === itemId);
              if (hit) {
                found = hit;
                break;
              }
            }
            if (found) {
              const ref = found.payload_ref || {};
              const pb =
                ref.mux_playback_id ||
                ref.muxPlaybackId ||
                ref.playback_id ||
                ref.playbackId ||
                null;
              setPlaybackId(pb);
            } else {
              setPlaybackId(null);
              setMetaErr("item não encontrado em /api/me/items");
            }
          } else {
            setPlaybackId(null);
            setMetaErr("falha validação módulos");
          }
        } else {
          setPlaybackId(null);
          setMetaErr("falha ao obter módulos");
        }
      } catch (e: any) {
        if (!alive) return;
        setPlaybackId(null);
        setMetaErr(String(e));
      } finally {
        if (!alive) return;
        setLoadingMeta(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [courseId, itemId, jwt, ready]);

  const DEBUG = process.env.NEXT_PUBLIC_DEBUG === "1";

  useVideoHeartbeat({
    enabled: !!(DEBUG && playing && jwt && itemId),
    jwt: jwt || "",
    courseId,
    moduleId,
    itemId,
    intervalMs: 15000,
    onBeat: (b) => {
      if (DEBUG) {
        setStatus({ lastBeatAt: new Date(b.at).toISOString() });
      }
    },
  });

  function onPlay() {
    setPlaying(true);
  }
  function onPause() {
    setPlaying(false);
  }

  const showPlayer = ready && !!jwt && !!playbackId;

  const infoRows = useMemo(
    () => [
      { k: "itemId", v: itemId },
      { k: "courseId", v: courseId || "-" },
      { k: "moduleId", v: moduleId || "-" },
      { k: "playbackId", v: playbackId || "-" },
      { k: "token", v: token ? "•••" : "-" },
    ],
    [itemId, courseId, moduleId, playbackId, token]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>Vídeo</h1>

      {err && (
        <div style={{ fontSize: 12, color: "#a00", whiteSpace: "pre-wrap" }}>
          Erro token: {err}
        </div>
      )}
      {metaErr && (
        <div style={{ fontSize: 12, color: "#a00", whiteSpace: "pre-wrap" }}>
          Erro meta: {metaErr}
        </div>
      )}

      <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
        {infoRows.map((r) => (
          <div key={r.k}>
            <strong>{r.k}:</strong>{" "}
            <code style={{ background: "#f2f2f4", padding: "2px 6px", borderRadius: 6 }}>{r.v}</code>
          </div>
        ))}
      </div>

      {!jwt && ready && <div style={{ fontSize: 14 }}>Faça login para reproduzir.</div>}

      {ready && jwt && loadingMeta && <div style={{ fontSize: 14 }}>Carregando metadata...</div>}

      {showPlayer && (
        <VideoPlayer
          playbackId={playbackId}
          playbackToken={token}
          onPlayChange={(p) => (p ? onPlay() : onPause())}
          debug={DEBUG}
        />
      )}

      {ready && jwt && !playbackId && !loadingMeta && (
        <div style={{ fontSize: 12, color: "#555" }}>
          PlaybackId não disponível neste item. Verifique payload_ref.mux_playback_id.
        </div>
      )}

      {DEBUG && status && (
        <pre
          style={{
            marginTop: 12,
            fontSize: 11,
            background: "#f8f8fa",
            padding: 8,
            border: "1px solid #eee",
            borderRadius: 8,
          }}
        >
          {JSON.stringify(status, null, 2)}
        </pre>
      )}
    </div>
  );
}
