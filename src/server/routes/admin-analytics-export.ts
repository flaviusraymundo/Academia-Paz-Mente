// src/server/routes/admin-analytics-export.ts
import { Router } from "express";
import { withClient } from "../lib/db";
import { isUuid } from "../utils/ids";
import {
  getTimeByModule,
  getCourseFunnel,
  getQuizStats,
  getCourseOverview,
  getUserTimeLeaderboard,
  getCourseWeekly
} from "../lib/analytics";

const router = Router();

function toCSV(rows: any[]): string {
  if (!rows?.length) return "";
  const cols = Object.keys(rows[0]);
  const head = cols.join(",");
  const body = rows
    .map((r) =>
      cols
        .map((c) => {
          const v = r[c];
          if (v == null) return "";
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");
  return head + "\n" + body + "\n";
}

/**
 * GET /api/admin/analytics/export?kind=time|funnel|quiz|overview|leaderboard|weekly&courseId=...&limit=20
 */
router.get("/export", async (req, res) => {
  const kind = String(req.query.kind || "");
  const courseId = String(req.query.courseId || "");
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 20)));

  if (!["time","funnel","quiz","overview","leaderboard","weekly"].includes(kind)) {
    return res.status(400).json({ error: "invalid_kind" });
  }
  // No seu contexto, todos exigem courseId válido (inclui overview)
  if (!isUuid(courseId)) {
    return res.status(400).json({ error: "invalid_courseId" });
  }

  const data = await withClient(async (c) => {
    switch (kind) {
      case "time":        return (await getTimeByModule(c, courseId)).rows;
      case "funnel":      return (await getCourseFunnel(c, courseId)).rows;
      case "quiz":        return (await getQuizStats(c, courseId)).rows;
      case "overview": {  const r = await getCourseOverview(c, courseId); return r.rows[0] ? [r.rows[0]] : []; }
      case "leaderboard": return (await getUserTimeLeaderboard(c, courseId, limit)).rows;
      case "weekly":      return (await getCourseWeekly(c, courseId, limit)).rows;
    }
    return [];
  });

  const csv = toCSV(data || []);
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${kind}_${courseId}.csv"`);
  res.status(200).send(csv);
});

export default router;
