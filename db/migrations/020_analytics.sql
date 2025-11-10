-- db/migrations/020_analytics.sql
-- Idempotente: MVs + UNIQUE para permitir REFRESH CONCURRENTLY.
-- A função usa apenas REFRESH normal (sem CONCURRENTLY). O CONCURRENTLY é feito no endpoint.

-- 1) Tempo por usuário x módulo
CREATE MATERIALIZED VIEW IF NOT EXISTS vw_module_time AS
SELECT
  p.user_id,
  p.module_id,
  SUM(COALESCE(p.time_spent_secs,0))::bigint AS time_spent_secs
FROM progress p
GROUP BY 1,2;

CREATE UNIQUE INDEX IF NOT EXISTS vw_module_time_unique
  ON vw_module_time(user_id, module_id);
CREATE INDEX IF NOT EXISTS vw_module_time_user_idx   ON vw_module_time(user_id);
CREATE INDEX IF NOT EXISTS vw_module_time_module_idx ON vw_module_time(module_id);

-- 2) Funil por curso (started / passed / failed) por módulo
-- Seu contrato usa exatamente: 'started','passed','failed','completed'
-- 'completed' conta como aprovado.
CREATE MATERIALIZED VIEW IF NOT EXISTS vw_course_funnel AS
WITH mm AS (
  SELECT m.id AS module_id, m.course_id, m."order"
  FROM modules m
),
pp AS (
  SELECT
    module_id,
    COUNT(*) FILTER (WHERE status IS NOT NULL)                 AS started_any,
    COUNT(*) FILTER (WHERE status IN ('passed','completed'))   AS passed_count,
    COUNT(*) FILTER (WHERE status = 'failed')                  AS failed_count
  FROM progress
  GROUP BY 1
)
SELECT
  mm.course_id,
  mm.module_id,
  mm."order",
  COALESCE(pp.started_any,0)  AS started_any,
  COALESCE(pp.passed_count,0) AS passed_count,
  COALESCE(pp.failed_count,0) AS failed_count
FROM mm
LEFT JOIN pp USING(module_id);

CREATE UNIQUE INDEX IF NOT EXISTS vw_course_funnel_unique
  ON vw_course_funnel(course_id, module_id);
CREATE INDEX IF NOT EXISTS vw_course_funnel_course_idx ON vw_course_funnel(course_id);
CREATE INDEX IF NOT EXISTS vw_course_funnel_order_idx  ON vw_course_funnel("order");

-- 3) Estatísticas de quiz (pass_rate baseado em 'passed')
CREATE MATERIALIZED VIEW IF NOT EXISTS vw_quiz_stats AS
WITH s AS (
  SELECT
    qz.id AS quiz_id,
    p.user_id,
    CASE WHEN p.status = 'passed' THEN 1 ELSE 0 END AS passed_bit
  FROM quizzes qz
  JOIN modules m ON m.id = qz.module_id
  JOIN progress p ON p.module_id = m.id
)
SELECT
  quiz_id,
  COUNT(DISTINCT user_id) AS attempted_users,
  SUM(passed_bit)         AS passed_users,
  ROUND(100.0 * SUM(passed_bit) / NULLIF(COUNT(DISTINCT user_id),0), 2) AS pass_rate
FROM s
GROUP BY quiz_id;

CREATE UNIQUE INDEX IF NOT EXISTS vw_quiz_stats_unique
  ON vw_quiz_stats(quiz_id);
CREATE INDEX IF NOT EXISTS vw_quiz_stats_quiz_idx ON vw_quiz_stats(quiz_id);

-- 4) Função de refresh (apenas REFRESH normal; CONCURRENTLY será feito no endpoint)
CREATE OR REPLACE FUNCTION refresh_analytics_views() RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW vw_module_time;
  REFRESH MATERIALIZED VIEW vw_course_funnel;
  REFRESH MATERIALIZED VIEW vw_quiz_stats;
END;
$$ LANGUAGE plpgsql;

-- 5) Índices base úteis em progress (ativar conforme necessidade)
CREATE INDEX IF NOT EXISTS idx_progress_module        ON progress(module_id);
CREATE INDEX IF NOT EXISTS idx_progress_module_status ON progress(module_id, status);
CREATE INDEX IF NOT EXISTS idx_progress_module_user   ON progress(module_id, user_id);
