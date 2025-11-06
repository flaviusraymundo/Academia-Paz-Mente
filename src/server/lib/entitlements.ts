// src/server/lib/entitlements.ts
import type { PoolClient } from "pg";

const ACTIVE_ENTITLEMENT_CLAUSE =
  "now() >= starts_at and now() < coalesce(ends_at,'9999-12-31'::timestamptz)";

type EntitlementRow = {
  id: string;
  user_id: string;
  course_id: string | null;
  track_id: string | null;
  source: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
};

export async function hasActiveCourseEntitlement(
  client: PoolClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  const direct = await client.query(
    `select 1 from entitlements where user_id = $1 and course_id = $2 and ${ACTIVE_ENTITLEMENT_CLAUSE} limit 1`,
    [userId, courseId]
  );
  if (direct.rowCount) return true;

  const { rows: tracks } = await client.query<{ track_id: string }>(
    `select track_id from track_courses where course_id = $1`,
    [courseId]
  );
  if (tracks.length === 0) return false;

  const trackIds = tracks.map((t) => t.track_id);
  const via = await client.query(
    `select 1 from entitlements where user_id = $1 and track_id = any($2::uuid[]) and ${ACTIVE_ENTITLEMENT_CLAUSE} limit 1`,
    [userId, trackIds]
  );
  return via.rowCount > 0;
}

export async function hasActiveTrackEntitlement(
  client: PoolClient,
  userId: string,
  trackId: string
): Promise<boolean> {
  const q = await client.query(
    `select 1 from entitlements where user_id = $1 and track_id = $2 and ${ACTIVE_ENTITLEMENT_CLAUSE} limit 1`,
    [userId, trackId]
  );
  return q.rowCount > 0;
}

export async function getActiveEntitlements(
  client: PoolClient,
  userId: string
): Promise<EntitlementRow[]> {
  const { rows } = await client.query<EntitlementRow>(
    `
    select id, user_id, course_id, track_id, source, starts_at, ends_at, created_at
      from entitlements
     where user_id = $1
       and ${ACTIVE_ENTITLEMENT_CLAUSE}
     order by created_at desc
    `,
    [userId]
  );
  return rows;
}

export { ACTIVE_ENTITLEMENT_CLAUSE };
