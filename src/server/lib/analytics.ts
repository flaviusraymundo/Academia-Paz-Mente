// src/server/lib/analytics.ts
import type { PoolClient } from "pg";

/** Tempo agregado por módulo dentro de um curso. */
export async function getTimeByModule(c: PoolClient, courseId: string) {
  return c.query(
    `
    SELECT m.course_id,
           m.id AS module_id,
           m.title,
           m."order",
           COALESCE(v.time_spent_secs, 0)::bigint AS time_spent_secs
      FROM modules m
      LEFT JOIN vw_module_time v ON v.module_id = m.id
     WHERE m.course_id = $1
     ORDER BY m."order" ASC, m.title ASC
    `,
    [courseId]
  );
}

/** Funil (started / passed / failed) por módulo. */
export async function getCourseFunnel(c: PoolClient, courseId: string) {
  return c.query(
    `
    SELECT f.course_id,
           f.module_id,
           m.title,
           f."order",
           f.started_any,
           f.passed_count,
           f.failed_count
      FROM vw_course_funnel f
      JOIN modules m ON m.id = f.module_id
     WHERE f.course_id = $1
     ORDER BY f."order" ASC, m.title ASC
    `,
    [courseId]
  );
}

/** Estatísticas de quizzes no curso. */
export async function getQuizStats(c: PoolClient, courseId: string) {
  return c.query(
    `
    SELECT q.id AS quiz_id,
           q.module_id,
           m.title AS module_title,
           COALESCE(s.attempted_users,0) AS attempted_users,
           COALESCE(s.passed_users,0)    AS passed_users,
           COALESCE(s.pass_rate,0)       AS pass_rate
      FROM quizzes q
      JOIN modules m ON m.id = q.module_id
      LEFT JOIN vw_quiz_stats s ON s.quiz_id = q.id
     WHERE m.course_id = $1
     ORDER BY m."order" ASC, m.title ASC
    `,
    [courseId]
  );
}
