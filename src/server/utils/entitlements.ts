import { pool } from "../lib/db.js";

export const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

export async function hasCourseAccess(userId: string, courseId: string): Promise<boolean> {
  if (!isUuid(userId) || !isUuid(courseId)) return false;

  // 1) Entitlement direto ao curso (janela de validade)
  const direct = await pool.query(
    `
    SELECT 1
      FROM entitlements
     WHERE user_id = $1 AND course_id = $2
       AND now() >= starts_at
       AND now() < COALESCE(ends_at, '9999-12-31'::timestamptz)
    `,
    [userId, courseId]
  );
  if (direct.rowCount > 0) return true;

  // 2) Via trilha da qual o curso participa
  const track = await pool.query<{ track_id: string }>(
    `
    SELECT tc.track_id
      FROM track_courses tc
     WHERE tc.course_id = $1
     LIMIT 1
    `,
    [courseId]
  );
  const trackId = track.rows[0]?.track_id;
  if (trackId) {
    const viaTrack = await pool.query(
      `
      SELECT 1
        FROM entitlements
       WHERE user_id = $1 AND track_id = $2
         AND now() >= starts_at
         AND now() < COALESCE(ends_at, '9999-12-31'::timestamptz)
      `,
      [userId, trackId]
    );
    if (viaTrack.rowCount > 0) return true;
  }

  // 3) Futuro: memberships → catálogo (não implementado aqui)
  return false;
}

export const uuidGuard = (s: string, name = "id") => {
  if (!isUuid(s)) {
    const err: any = new Error("invalid_id");
    err.status = 400;
    err.payload = { error: "invalid_id", param: name };
    throw err;
  }
};
