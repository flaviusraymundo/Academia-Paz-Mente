import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { requireAdmin } from "../middleware/admin.js";
import { uuidGuard } from "../utils/entitlements.js";

const router = Router();

function badRequest(res: Response, payload: any) {
  return res.status(400).json(payload);
}

// GET /me/entitlements  → lista entitlements ativos do usuário
router.get("/me/entitlements", async (req: Request, res: Response) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const { rows } = await pool.query(
    `
    SELECT id, user_id, course_id, track_id, source, starts_at, ends_at, created_at
      FROM entitlements
     WHERE user_id = $1
       AND now() >= starts_at
       AND now() < COALESCE(ends_at, '9999-12-31'::timestamptz)
     ORDER BY created_at DESC
    `,
    [userId]
  );
  return res.json({ entitlements: rows });
});

// POST /admin/entitlements  (admin)  → cria ou revoga
// Body: { userId, courseId?, trackId?, source, startsAt?, endsAt?, revoke?: boolean }
router.post("/admin/entitlements", requireAdmin, async (req: Request, res: Response) => {
  const { userId, courseId, trackId, source, startsAt, endsAt, revoke } = req.body || {};
  try {
    uuidGuard(userId, "userId");
    if (!courseId && !trackId) {
      return badRequest(res, { error: "missing_scope", detail: "courseId or trackId required" });
    }
    if (courseId) uuidGuard(courseId, "courseId");
    if (trackId) uuidGuard(trackId, "trackId");
    if (!source || typeof source !== "string") {
      return badRequest(res, { error: "invalid_source" });
    }

    // revoke → encerra entitlement
    if (revoke) {
      const { rows } = await pool.query(
        `
        UPDATE entitlements
           SET ends_at = now()
         WHERE user_id = $1
           AND (
             ($2::uuid IS NOT NULL AND course_id = $2) OR
             ($3::uuid IS NOT NULL AND track_id = $3)
           )
           AND now() < COALESCE(ends_at, '9999-12-31'::timestamptz)
         RETURNING id, user_id, course_id, track_id, source, starts_at, ends_at, created_at
        `,
        [userId, courseId ?? null, trackId ?? null]
      );
      const revoked = rows[0] ?? null;
      return res.json({ revoked: Boolean(revoked), entitlement: revoked });
    }

    let entitlementRow;
    if (courseId) {
      const { rows } = await pool.query(
        `
        INSERT INTO entitlements (user_id, course_id, track_id, source, starts_at, ends_at)
        VALUES ($1, $2, NULL, $3,
                COALESCE($4::timestamptz, now()),
                $5::timestamptz)
        ON CONFLICT (user_id, course_id)
        DO UPDATE SET source = EXCLUDED.source,
                      starts_at = EXCLUDED.starts_at,
                      ends_at = EXCLUDED.ends_at
        RETURNING id, user_id, course_id, track_id, source, starts_at, ends_at, created_at
        `,
        [userId, courseId, source, startsAt ?? null, endsAt ?? null]
      );
      entitlementRow = rows[0];
    } else {
      const { rows } = await pool.query(
        `
        INSERT INTO entitlements (user_id, course_id, track_id, source, starts_at, ends_at)
        VALUES ($1, NULL, $2, $3,
                COALESCE($4::timestamptz, now()),
                $5::timestamptz)
        ON CONFLICT (user_id, track_id)
        DO UPDATE SET source = EXCLUDED.source,
                      starts_at = EXCLUDED.starts_at,
                      ends_at = EXCLUDED.ends_at
        RETURNING id, user_id, course_id, track_id, source, starts_at, ends_at, created_at
        `,
        [userId, trackId, source, startsAt ?? null, endsAt ?? null]
      );
      entitlementRow = rows[0];
    }

    if (!entitlementRow) {
      return res.status(500).json({ error: "entitlement_upsert_failed" });
    }

    return res.json({ entitlement: entitlementRow });
  } catch (e: any) {
    if (e?.status === 400) return res.status(400).json(e.payload || { error: "bad_request" });
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
