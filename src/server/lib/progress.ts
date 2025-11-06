// src/server/lib/progress.ts
import type { PoolClient } from "pg";

export async function allModulesPassed(
  client: PoolClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  const q = await client.query<{ ok: boolean }>(
    `with mods as (select id from modules where course_id=$1)
     select coalesce(bool_and(p.status in ('passed','completed')), false) as ok
       from mods m
  left join progress p on p.module_id=m.id and p.user_id=$2`,
    [courseId, userId]
  );
  return Boolean(q.rows[0]?.ok);
}
