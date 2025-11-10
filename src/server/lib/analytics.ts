// src/server/lib/analytics.ts
import type { PoolClient } from "pg";

/** Tempo agregado por módulo dentro de um curso (soma de todos os usuários). */
export async function getTimeByModule(c: PoolClient, courseId: string) {
  return c.query(
    `
    SELECT
      m.course_id,
      m.id   AS module_id,
      m.title,
      m."order",
      COALESCE(SUM(v.time_spent_secs), 0)::bigint AS time_spent_secs
    FROM modules m
    LEFT JOIN vw_module_time v
      ON v.module_id = m.id
    WHERE m.course_id = $1
    GROUP BY m.course_id, m.id, m.title, m."order"
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

/** Overview do curso (síntese tempo + somas de funnel). */
export async function getCourseOverview(c: PoolClient, courseId: string) {
  return c.query(
    `
    SELECT *
      FROM vw_course_overview
     WHERE course_id = $1
     LIMIT 1
    `,
    [courseId]
  );
}

/** Leaderboard de tempo por usuário para um curso (top N). */
export async function getUserTimeLeaderboard(c: PoolClient, courseId: string, limit = 20) {
  return c.query(
    `
    SELECT u.email, t.user_id, t.time_spent_secs
      FROM vw_user_course_time t
 LEFT JOIN users u ON u.id = t.user_id
     WHERE t.course_id = $1
     ORDER BY t.time_spent_secs DESC
     LIMIT $2
    `,
    [courseId, limit]
  );
}

/** Coortes semanais do curso (últimas N linhas por order desc). */
export async function getCourseWeekly(c: PoolClient, courseId: string, weeks = 12) {
  return c.query(
    `
    SELECT course_id, week_start, users_active, time_spent_secs, modules_started, modules_passed
      FROM vw_course_weekly
     WHERE course_id = $1
     ORDER BY week_start DESC
     LIMIT $2
    `,
    [courseId, weeks]
  );
}

/** Drop-off por módulo (onde os alunos param). */
export async function getCourseDropoff(c: PoolClient, courseId: string) {
  return c.query(
    `
    SELECT d.module_order, m.title,
           d.drop_after_prev, d.stopped_here
      FROM vw_course_dropoff d
      JOIN modules m
        ON m.course_id = d.course_id
       AND m."order"    = d.module_order
     WHERE d.course_id = $1
     ORDER BY d.module_order ASC
    `,
    [courseId]
  );
}

/** Tempos (medianas p50/p90) por módulo e agregados do curso. */
export async function getDurations(c: PoolClient, courseId: string) {
  const mods = await c.query(
    `
    SELECT s.module_id, m.title,
           s.p50_secs::bigint, s.p90_secs::bigint, s.avg_secs::bigint
      FROM vw_module_time_stats s
      JOIN modules m ON m.id = s.module_id
     WHERE s.course_id = $1
     ORDER BY m."order" ASC
    `,
    [courseId]
  );
  const course = await c.query(
    `
    SELECT p50_secs::bigint, p90_secs::bigint, avg_secs::bigint
      FROM vw_course_time_stats
     WHERE course_id = $1
    `,
    [courseId]
  );
  return { modules: mods.rows, course: course.rows[0] || null };
}
