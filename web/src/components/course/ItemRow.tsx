import Link from "next/link";
import { Item } from "../../types/course";

export function ItemRow({ item, courseId, moduleId }: { item: Item; courseId: string; moduleId: string }) {
  const link =
    item.type === "quiz"
      ? `/quiz/${encodeURIComponent(item.payload_ref?.quiz_id || "")}`
      : item.type === "video"
      ? `/video/${encodeURIComponent(item.item_id)}?courseId=${encodeURIComponent(courseId)}&moduleId=${encodeURIComponent(moduleId)}`
      : `/text/${encodeURIComponent(item.item_id)}?courseId=${encodeURIComponent(courseId)}&moduleId=${encodeURIComponent(moduleId)}`;

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
        <strong style={{ textTransform: "uppercase", fontSize: 12, color: "#333" }}>{item.type}</strong>
        <span style={{ fontSize: 12, color: "#666" }}>itemId: <code>{item.item_id}</code></span>
      </div>
      <div style={{ marginTop: 8 }}>
        <Link
          href={link}
          style={{
            display: "inline-block",
            background: "var(--color-primary)",
            color: "#fff",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 13,
            textDecoration: "none",
          }}
          data-testid={`course-module-item-link-${moduleId}-${item.item_id}`}
        >
          Abrir {item.type}
        </Link>
      </div>
    </li>
  );
}
