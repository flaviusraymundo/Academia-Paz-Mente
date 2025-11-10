-- db/migrations/023_course_weekly.sql
-- Idempotente: DROP + CREATE da MV de coortes semanais por curso.

DROP MATERIALIZED VIEW IF EXISTS vw_course_weekly;

-- Observações:
-- users_active     = usuários distintos com qualquer progresso no curso na semana
-- time_spent_secs  = soma de tempo na semana
-- modules_started  = soma de eventos de "início" na semana (status IS NOT NULL)
-- modules_passed   = soma de eventos com status 'passed' ou 'completed' na semana
-- Fonte de tempo/status: progress.updated_at e progress.time_spent_secs

CREATE MATERIALIZED VIEW vw_course_weekly AS
WITH prog AS (
  SELECT
    p.user_id,
    m.course_id,
    date_trunc('week', p.updated_at)::date AS week_start,
    COALESCE(p.time_spent_secs,0)::bigint     AS time_spent_secs,
    (p.status IS NOT NULL)::int               AS started_bit,
    (p.status IN ('passed','completed'))::int AS passed_bit
  FROM progress p
  JOIN modules m ON m.id = p.module_id
)
SELECT
  course_id,
  week_start,
  COUNT(DISTINCT user_id)      AS users_active,
  SUM(time_spent_secs)::bigint AS time_spent_secs,
  SUM(started_bit)::bigint     AS modules_started,
  SUM(passed_bit)::bigint      AS modules_passed
FROM prog
GROUP BY course_id, week_start
ORDER BY course_id, week_start;

CREATE UNIQUE INDEX vw_course_weekly_unique
  ON vw_course_weekly(course_id, week_start);

CREATE INDEX vw_course_weekly_week_idx
  ON vw_course_weekly(week_start);
