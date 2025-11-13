import type { ReactNode } from "react";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";

export function CourseHeader({
  title,
  right,
}: {
  title: ReactNode;
  right?: ReactNode;
}) {
  return (
    <Card data-testid="course-header" style={{ gap: 10, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>{title}</h1>
        {right}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Badge tone="info">curso</Badge>
      </div>
    </Card>
  );
}
