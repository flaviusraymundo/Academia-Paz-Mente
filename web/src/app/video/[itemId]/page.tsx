"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useAuth } from "../../../contexts/AuthContext";

export default function VideoItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const qs = useSearchParams();
  const courseId = qs.get("courseId") || "";
  const moduleId = qs.get("moduleId") || "";
  const { jwt, ready } = useAuth();

  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!jwt) {
      setToken(null);
      setErr(null);
      setStatus(null);
      return;
    }
    let alive = true;
    (async () => {
      const { status, body } = await api(`/api/video/${encodeURIComponent(itemId)}/playback-token`, {
        method: "POST"
      });
      if (!alive) return;
      if (status === 200) setToken(body?.token || null);
      else setErr(JSON.stringify({ status, body }));
    })();
    return () => { alive = false; };
  }, [itemId, jwt, ready]);

  async function beat() {
    const { status, body } = await api(`/api/video/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ courseId, moduleId, itemId, secs: 15 })
    });
    setStatus({ status, body });
  }

  const DEBUG = process.env.NEXT_PUBLIC_DEBUG === "1";

  return (
    <div>
      <h1>Vídeo</h1>
      {err && <pre style={{ color: "crimson" }}>{err}</pre>}
      <p><strong>itemId:</strong> <code>{itemId}</code></p>
      <p><strong>courseId:</strong> <code>{courseId || "-"}</code></p>
      <p><strong>moduleId:</strong> <code>{moduleId || "-"}</code></p>
      {DEBUG && (
        <>
          <p><strong>playback token:</strong> <code>{token || "-"}</code></p>
          <button onClick={beat} style={{ padding: "8px 12px" }}>Enviar heartbeat (15s)</button>
          {status && <pre style={{ marginTop: 12 }}>{JSON.stringify(status, null, 2)}</pre>}
          <p style={{ color:"#666" }}>Debug: validando token e heartbeat.</p>
        </>
      )}
    </div>
  );
}
