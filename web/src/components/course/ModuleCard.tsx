import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { ItemRow } from "./ItemRow";
import type { Module } from "../../types/course";

export function ModuleCard({ m, courseId }: { m: Module; courseId: string }) {
  return (
    <Card data-testid={`course-module-card-${m.id}`} style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          padding: 12,
          background: "#fafafa",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 16 }}>{m.order}. {m.title}</strong>
        <div style={{ display: "flex", gap: 6 }}>
          <Badge tone={m.unlocked ? "success" : "warn"}>{m.unlocked ? "desbloqueado" : "bloqueado"}</Badge>
          <Badge tone="info">status: {m.progress?.status ?? "-"}</Badge>
          <Badge tone="neutral">{m.itemCount ?? m.items?.length ?? 0} itens</Badge>
        </div>
      </div>
      <ul style={{ margin: 0, padding: 12, display: "grid", gap: 10 }}>
        {m.items?.map((it) => (
          <ItemRow key={it.item_id} item={it} courseId={courseId} moduleId={m.id} />
        ))}
      </ul>
    </Card>
  );
}
