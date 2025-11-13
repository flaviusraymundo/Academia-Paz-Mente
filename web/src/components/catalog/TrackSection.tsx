import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { CourseCard, Course } from "./CourseCard";

interface TrackRel {
  courseId: string;
  order: number;
  required: boolean;
}

export interface Track {
  id: string;
  slug?: string;
  title: string;
  active?: boolean;
  courses: TrackRel[];
}

export function TrackSection({ track, coursesById }:{
  track: Track;
  coursesById: Record<string, Course>;
}) {
  return (
    <Card style={{ gap:20 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <h2 style={{ margin:0, fontSize:20 }}>{track.title}</h2>
        {track.active === false && <Badge tone="warn">inativa</Badge>}
        {track.slug && <Badge tone="info">{track.slug}</Badge>}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
        {track.courses
          .slice()
          .sort((a,b)=>a.order-b.order)
          .map(rel => {
            const c = coursesById[rel.courseId];
            if (!c) return null;
            return (
              <div key={`${track.id}-${rel.courseId}`} style={{ position:"relative" }}>
                <div style={{ position:"absolute", left:-12, top:10, fontSize:11, color:"#777" }}>{rel.order}.</div>
                <CourseCard course={c} />
                <div style={{ display:"flex", gap:6, marginTop:6 }}>
                  {rel.required && <Badge tone="success">obrigatório</Badge>}
                </div>
              </div>
            );
          })}
      </div>
    </Card>
  );
}
