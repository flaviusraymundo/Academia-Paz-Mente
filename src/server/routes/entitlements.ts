// src/server/routes/entitlements.ts
import { Router, Request, Response } from "express";
import { withClient } from "../db";
import { requireAuth } from "../middleware/auth";
import { isUuid } from "../utils/ids";
import {
  getActiveEntitlements,
  hasActiveCourseEntitlement,
  hasActiveTrackEntitlement,
} from "../lib/entitlements";

const router = Router();

// GET /api/entitlements → lista entitlements ativos do usuário autenticado
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.auth?.userId ?? req.user?.id ?? null;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  try {
    const entitlements = await withClient((c) => getActiveEntitlements(c, userId));
    return res.json({ entitlements });
  } catch (err) {
    console.error("GET /api/entitlements error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// POST /api/entitlements/check → { courseId? | trackId? } => { ok:boolean }
router.post("/check", requireAuth, async (req: Request, res: Response) => {
  const userId = req.auth?.userId ?? req.user?.id ?? null;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  const { courseId, trackId } = req.body || {};
  if (!courseId && !trackId) return res.status(400).json({ error: "course_or_track_required" });
  if (courseId && !isUuid(String(courseId))) return res.status(400).json({ error: "invalid_courseId" });
  if (trackId && !isUuid(String(trackId))) return res.status(400).json({ error: "invalid_trackId" });
  try {
    const ok = await withClient((c) =>
      courseId
        ? hasActiveCourseEntitlement(c, userId, String(courseId))
        : hasActiveTrackEntitlement(c, userId, String(trackId))
    );
    return res.json({ ok });
  } catch (err) {
    console.error("POST /api/entitlements/check error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
