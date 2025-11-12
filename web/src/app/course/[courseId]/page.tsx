"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";

type Item = { item_id: string; type: "video" | "text" | "quiz"; order: number; payload_ref: any };
type Module = {
  id: string;
  title: string;
  order: number;
  unlocked: boolean;
  itemCount: number;
  items: Item[];
  progress: { status: string; score: number; timeSpentSecs: number };
};

export default function CoursePage() {
  const params = useParams<{ courseId: string }>();
  const courseId = params.courseId;
  const [mods, setMods] = useState<Module[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const qs = new URLSearchParams({ courseId });
      const { status, body } = await api(`/api/me/items?${qs.toString()}`);
      if (!alive) return;
      if (status === 200) setMods(body.items || []);
      else setErr(JSON.stringify({ status, body }));
    })();
    return () => { alive = false; };
  }, [courseId]);

  return (
    <div>
      <h1>Curso</h1>
      {err && <pre style={{ color: "crimson" }}>{err}</pre>}
      {mods.map(m => (
        <div key={m.id} style={{ border: "1px solid #eee", marginBottom: 12, borderRadius: 8 }}>
          <div style={{ padding: 12, background: "#fafafa", borderBottom: "1px solid #eee" }}>
            <strong>{m.order}. {m.title}</strong>
            <span style={{ marginLeft: 8, color: m.unlocked ? "green" : "#999" }}>
              {m.unlocked ? "desbloqueado" : "bloqueado"}
            </span>
            <span style={{ marginLeft: 8, color: "#555" }}>status: {m.progress.status}</span>
          </div>
          <ul style={{ margin: 0, padding: 12 }}>
            {m.items.map(it => (
              <li key={it.item_id} style={{ marginBottom: 6 }}>
                {it.order}. {it.type}
                {it.type === "quiz" && (
                  <Link href={`/quiz/${encodeURIComponent(it.payload_ref?.quiz_id || "")}`}>- abrir quiz</Link>
                )}
                {it.type === "video" && (
                  <> - <Link href={`/video/${encodeURIComponent(it.item_id)}?courseId=${encodeURIComponent(courseId)}&moduleId=${encodeURIComponent(m.id)}`}>abrir vídeo</Link></>
                )}
                {it.type === "text" && (
                  <> - <Link href={`/text/${encodeURIComponent(it.item_id)}?courseId=${encodeURIComponent(courseId)}&moduleId=${encodeURIComponent(m.id)}`}>abrir texto</Link></>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
