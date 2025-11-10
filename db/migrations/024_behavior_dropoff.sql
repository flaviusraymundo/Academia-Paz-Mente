-- db/migrations/024_behavior_dropoff.sql
-- Diagnóstico de drop-off: onde os alunos param no curso.

-- Último módulo "atingido" por usuário no curso (maior order com status não nulo)
DROP MATERIALIZED VIEW IF EXISTS vw_course_path;

CREATE MATERIALIZED VIEW vw_course_path AS
WITH prog AS (
  SELECT p.user_id, m.course_id, m."order", p.status, p.updated_at
  FROM progress p
  JOIN modules m ON m.id = p.module_id
),
agg AS (
  SELECT
    user_id, course_id,
    MAX(CASE WHEN status IS NOT NULL THEN "order" END)               AS max_order_seen,
    MAX(CASE WHEN status IN ('passed','completed') THEN "order" END) AS max_order_passed,
    MIN(updated_at) AS first_seen,
    MAX(updated_at) AS last_seen
  FROM prog
  GROUP BY user_id, course_id
)
SELECT * FROM agg;

CREATE UNIQUE INDEX IF NOT EXISTS vw_course_path_unique
  ON vw_course_path(user_id, course_id);

-- Drop-off por módulo: quantos não avançaram após o módulo N
DROP MATERIALIZED VIEW IF EXISTS vw_course_dropoff;

CREATE MATERIALIZED VIEW vw_course_dropoff AS
WITH mods AS (
  SELECT course_id, "order" FROM modules
),
paths AS (
  SELECT course_id, max_order_seen, max_order_passed FROM vw_course_path
)
SELECT
  m.course_id,
  m."order"                       AS module_order,
  COUNT(*) FILTER (WHERE COALESCE(p.max_order_passed, -1) = m."order" - 1) AS drop_after_prev, -- parou antes de iniciar este
  COUNT(*) FILTER (WHERE COALESCE(p.max_order_seen, -1) = m."order")       AS stopped_here      -- chegou aqui e não passou
FROM mods m
LEFT JOIN paths p ON p.course_id = m.course_id
GROUP BY m.course_id, m."order"
ORDER BY m.course_id, m."order";

CREATE UNIQUE INDEX IF NOT EXISTS vw_course_dropoff_unique
  ON vw_course_dropoff(course_id, module_order);
