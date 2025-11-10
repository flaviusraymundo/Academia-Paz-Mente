// src/server/routes/admin-analytics.ts
import { Router } from "express";
import { withClient } from "../lib/db.js";
import { isUuid } from "../utils/ids.js";
import {
  getTimeByModule,
  getCourseFunnel,
  getQuizStats,
  getCourseOverview,
  getUserTimeLeaderboard,
  // NOVO: endpoint de coortes semanais
  getCourseWeekly
} from "../lib/analytics.js";

const router = Router();

/**
 * Montado em: /api/admin/analytics
 * Endpoints:
 *   GET  /time?courseId=...
 *   GET  /funnel?courseId=...
 *   GET  /quiz?courseId=...
 *   GET  /overview?courseId=...
 *   GET  /time/users?courseId=...&limit=20
 *   GET  /weekly?courseId=...&weeks=12
 *   POST /refresh
 */

router.get("/time", async (req, res) => {
  const courseId = String(req.query.courseId || "");
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_courseId" });
  const r = await withClient((c) => getTimeByModule(c, courseId));
  res.json({ rows: r.rows });
});

router.get("/funnel", async (req, res) => {
  const courseId = String(req.query.courseId || "");
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_courseId" });
  const r = await withClient((c) => getCourseFunnel(c, courseId));
  res.json({ rows: r.rows });
});

router.get("/quiz", async (req, res) => {
  const courseId = String(req.query.courseId || "");
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_courseId" });
  const r = await withClient((c) => getQuizStats(c, courseId));
  res.json({ rows: r.rows });
});

router.get("/overview", async (req, res) => {
  const courseId = String(req.query.courseId || "");
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_courseId" });
  const r = await withClient((c) => getCourseOverview(c, courseId));
  res.json({ row: r.rows[0] || null });
});

router.get("/time/users", async (req, res) => {
  const courseId = String(req.query.courseId || "");
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 20)));
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_courseId" });
  const r = await withClient((c) => getUserTimeLeaderboard(c, courseId, limit));
  res.json({ rows: r.rows });
});

/** GET /api/admin/analytics/weekly?courseId=...&weeks=12 */
router.get("/weekly", async (req, res) => {
  const courseId = String(req.query.courseId || "");
  const rawWeeks = Number(req.query.weeks || 12);
  // bound: 1..104 (2 anos)
  const weeks = Math.max(1, Math.min(104, isNaN(rawWeeks) ? 12 : rawWeeks));
  if (!isUuid(courseId)) {
    return res.status(400).json({ error: "invalid_courseId" });
  }
  const r = await withClient((c) => getCourseWeekly(c, courseId, weeks));
  res.json({ rows: r.rows });
});

router.post("/refresh", async (_req, res) => {
  async function tryRefresh(client: any, mv: string) {
    try {
      await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${mv}`);
    } catch {
      await client.query(`REFRESH MATERIALIZED VIEW ${mv}`);
    }
  }
  try {
    await withClient(async (c) => {
      await tryRefresh(c, "vw_module_time");
      await tryRefresh(c, "vw_course_funnel");
      await tryRefresh(c, "vw_quiz_stats");
      await tryRefresh(c, "vw_course_time");
      await tryRefresh(c, "vw_course_overview");
      await tryRefresh(c, "vw_user_course_time");
      await tryRefresh(c, "vw_course_weekly");
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/admin/analytics/refresh error", e);
    res.status(500).json({ error: "refresh_failed" });
  }
});

export default router;
