import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { uuidGuard } from "../utils/entitlements.js";

const router = Router();

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

function badRequest(res: Response, payload: any) {
  return res.status(400).json(payload);
}

// GET /me/entitlements  → lista entitlements ativos do usuário
router.get("/me/entitlements", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId || !isUuid(userId)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const rows = await pool.any(
    `
    SELECT id, user_id, course_id, track_id, source, starts_at, ends_at, created_at
      FROM entitlements
     WHERE user_id=$1
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
router.post("/admin/entitlements", async (req: Request, res: Response) => {
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
      const r = await pool.oneOrNone(
        `
        UPDATE entitlements
           SET ends_at = now()
         WHERE user_id=$1
           AND ($2::uuid IS NOT NULL AND course_id=$2 OR $3::uuid IS NOT NULL AND track_id=$3)
           AND now() < COALESCE(ends_at, '9999-12-31'::timestamptz)
         RETURNING *
        `,
        [userId, courseId || null, trackId || null]
      );
      return res.json({ revoked: !!r, entitlement: r });
    }

    // upsert (único por (user, course) ou (user, track))
    const row = await pool.one(
      `
      INSERT INTO entitlements (id, user_id, course_id, track_id, source, starts_at, ends_at, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4,
              COALESCE($5::timestamptz, now()),
              $6::timestamptz,
              now())
      ON CONFLICT (user_id, course_id) WHERE $2 IS NOT NULL
      DO UPDATE SET source=EXCLUDED.source,
                    starts_at=EXCLUDED.starts_at,
                    ends_at=EXCLUDED.ends_at
      RETURNING id, user_id, course_id, track_id, source, starts_at, ends_at, created_at
      `,
      [userId, courseId || null, trackId || null, source, startsAt || null, endsAt || null]
    );

    // Caso trackId (conflito parcial diferente)
    if (!row) {
      const row2 = await pool.one(
        `
        INSERT INTO entitlements (id, user_id, course_id, track_id, source, starts_at, ends_at, created_at)
        VALUES (gen_random_uuid(), $1, NULL, $2, $3,
                COALESCE($4::timestamptz, now()),
                $5::timestamptz,
                now())
        ON CONFLICT (user_id, track_id) WHERE $2 IS NOT NULL
        DO UPDATE SET source=EXCLUDED.source,
                      starts_at=EXCLUDED.starts_at,
                      ends_at=EXCLUDED.ends_at
        RETURNING id, user_id, course_id, track_id, source, starts_at, ends_at, created_at
        `,
        [userId, trackId, source, startsAt || null, endsAt || null]
      );
      return res.json({ entitlement: row2 });
    }

    return res.json({ entitlement: row });
  } catch (e: any) {
    if (e?.status === 400) return res.status(400).json(e.payload || { error: "bad_request" });
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
