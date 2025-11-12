import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import Link from "next/link";

export interface Course {
  id: string;
  slug?: string;
  title: string;
  summary?: string;
  level?: string;
  active?: boolean;
  module_count?: number;
  item_count?: number;
}

export function CourseCard({ course }: { course: Course }) {
  return (
    <Card style={{ gap: 10 }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
        <h3 style={{ margin:"0 0 4px 0", fontSize:17 }}>{course.title}</h3>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {course.level && <Badge tone="level">{course.level}</Badge>}
          {course.active === false && <Badge tone="warn">inativo</Badge>}
          {course.module_count != null && <Badge tone="info">{course.module_count} módulos</Badge>}
          {course.item_count != null && <Badge tone="neutral">{course.item_count} itens</Badge>}
        </div>
      </div>
      {course.summary && <p style={{ margin:0, fontSize:13, color:"var(--color-text-soft)" }}>{course.summary}</p>}
      <div style={{ display:"flex", gap:8 }}>
        <Link
          href={`/course/${encodeURIComponent(course.id)}`}
          style={{
            display:"inline-block",
            fontSize:13,
            background:"var(--color-primary)",
            color:"#fff",
            padding:"6px 12px",
            borderRadius:6,
            textDecoration:"none"
          }}>
          Abrir curso
        </Link>
        {course.slug && <code style={{ fontSize:11, alignSelf:"center" }}>{course.slug}</code>}
      </div>
    </Card>
  );
}
