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
  getCourseWeekly,
  getCourseDropoff,
  getDurations
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
 *   GET  /dropoff?courseId=...
 *   GET  /durations?courseId=...
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
  const weeks = Math.max(1, Math.min(104, Number(req.query.weeks || 12)));
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_courseId" });
  const r = await withClient((c) => getCourseWeekly(c, courseId, weeks));
  res.json({ rows: r.rows });
});

router.get("/dropoff", async (req, res) => {
  const courseId = String(req.query.courseId || "");
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_courseId" });
  const r = await withClient((c) => getCourseDropoff(c, courseId));
  res.json({ rows: r.rows });
});

router.get("/durations", async (req, res) => {
  const courseId = String(req.query.courseId || "");
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_courseId" });
  const r = await withClient((c) => getDurations(c, courseId));
  res.json(r);
});

/** Refresh de todas as MVs (CONCURRENTLY com fallback) */
router.post("/refresh", async (_req, res) => {
  async function tryRefresh(client: any, mv: string) {
    try { await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${mv}`); }
    catch { await client.query(`REFRESH MATERIALIZED VIEW ${mv}`); }
  }
  try {
    await withClient(async (c) => {
      await tryRefresh(c, "vw_module_time");
      await tryRefresh(c, "vw_course_funnel");
      await tryRefresh(c, "vw_quiz_stats");
      await tryRefresh(c, "vw_course_time");
      await tryRefresh(c, "vw_course_overview");
      await tryRefresh(c, "vw_user_course_time");
      await tryRefresh(c, "vw_course_weekly"); // novo
      await tryRefresh(c, "vw_course_path");
      await tryRefresh(c, "vw_course_dropoff");
      await tryRefresh(c, "vw_module_time_user");
      await tryRefresh(c, "vw_module_time_stats");
      await tryRefresh(c, "vw_course_time_stats");
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/admin/analytics/refresh error", e);
    res.status(500).json({ error: "refresh_failed" });
  }
});

export default router;
