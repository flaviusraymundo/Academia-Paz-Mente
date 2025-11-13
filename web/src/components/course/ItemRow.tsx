import type { CSSProperties } from "react";
import Link from "next/link";
import { Item } from "../../types/course";

export function ItemRow({ item, courseId, moduleId }: { item: Item; courseId: string; moduleId: string }) {
  const t = String(item.type || "").toLowerCase();
  const isQuiz = t === "quiz";
  const isVideo = t === "video";
  const isText = t === "text";

  const ref: any = (item as any).payload_ref ?? (item as any).payloadRef ?? {};
  const quizId = ref?.quiz_id || "";

  const link = isQuiz
    ? quizId
      ? `/quiz/${encodeURIComponent(quizId)}`
      : undefined
    : isVideo
    ? `/video/${encodeURIComponent(item.item_id)}?courseId=${encodeURIComponent(courseId)}&moduleId=${encodeURIComponent(moduleId)}`
    : isText
    ? `/text/${encodeURIComponent(item.item_id)}?courseId=${encodeURIComponent(courseId)}&moduleId=${encodeURIComponent(moduleId)}`
    : undefined;

  return (
    <li
      data-testid={`course-module-item-${moduleId}-${item.item_id}`}
      style={{
        listStyle: "none",
        padding: 12,
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        background: "var(--color-surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#777", fontSize: 12 }}>{item.order}.</span>
        <strong style={{ textTransform: "uppercase", fontSize: 12, color: "#333" }}>{t.toUpperCase()}</strong>
        <span style={{ fontSize: 12, color: "#666" }}>itemId: <code>{item.item_id}</code></span>
      </div>
      <div style={{ marginTop: 8 }}>
        {link ? (
          <Link
            href={link}
            style={primaryBtn}
            data-testid={`course-module-item-link-${moduleId}-${item.item_id}`}
          >
            Abrir {isQuiz ? "quiz" : isVideo ? "vídeo" : "texto"}
          </Link>
        ) : (
          <span style={{ fontSize: 12, color: "#777" }}>
            {isQuiz ? "quiz_id ausente no payload_ref" : "Tipo não suportado para abertura direta."}
          </span>
        )}
      </div>
    </li>
  );
}

const primaryBtn: CSSProperties = {
  display: "inline-block",
  background: "var(--color-primary)",
  color: "#fff",
  padding: "6px 10px",
  borderRadius: 6,
  fontSize: 13,
  textDecoration: "none",
};
