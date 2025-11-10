-- db/migrations/025_durations.sql
-- Medianas/tempos por módulo e por curso (p50/p90/média) com base no tempo acumulado por usuário.

DROP MATERIALIZED VIEW IF EXISTS vw_module_time_user;

CREATE MATERIALIZED VIEW vw_module_time_user AS
SELECT
  p.user_id,
  m.id AS module_id,
  m.course_id,
  COALESCE(p.time_spent_secs,0)::bigint AS time_spent_secs
FROM progress p
JOIN modules m ON m.id = p.module_id;

CREATE UNIQUE INDEX IF NOT EXISTS vw_module_time_user_unique
  ON vw_module_time_user(user_id, module_id);

DROP MATERIALIZED VIEW IF EXISTS vw_module_time_stats;

CREATE MATERIALIZED VIEW vw_module_time_stats AS
SELECT
  course_id,
  module_id,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_spent_secs) AS p50_secs,
  PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY time_spent_secs) AS p90_secs,
  AVG(time_spent_secs)::bigint AS avg_secs
FROM vw_module_time_user
GROUP BY course_id, module_id;

CREATE UNIQUE INDEX IF NOT EXISTS vw_module_time_stats_unique
  ON vw_module_time_stats(course_id, module_id);

DROP MATERIALIZED VIEW IF EXISTS vw_course_time_stats;

CREATE MATERIALIZED VIEW vw_course_time_stats AS
SELECT
  course_id,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY user_sum) AS p50_secs,
  PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY user_sum) AS p90_secs,
  AVG(user_sum)::bigint AS avg_secs
FROM (
  SELECT course_id, user_id, SUM(time_spent_secs)::bigint AS user_sum
  FROM vw_module_time_user
  GROUP BY course_id, user_id
) s
GROUP BY course_id;

CREATE UNIQUE INDEX IF NOT EXISTS vw_course_time_stats_unique
  ON vw_course_time_stats(course_id);
