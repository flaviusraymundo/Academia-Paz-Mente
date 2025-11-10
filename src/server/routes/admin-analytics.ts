// src/server/routes/admin-analytics.ts
import { Router } from "express";
import { withClient } from "../lib/db.js";
import { isUuid } from "../utils/ids.js";
import { getTimeByModule, getCourseFunnel, getQuizStats } from "../lib/analytics.js";

const router = Router();

/**
 * Montado em: /api/admin/analytics
 * Endpoints:
 *   GET  /time?courseId=...
 *   GET  /funnel?courseId=...
 *   GET  /quiz?courseId=...
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
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/admin/analytics/refresh error", e);
    res.status(500).json({ error: "refresh_failed" });
  }
});

export default router;
