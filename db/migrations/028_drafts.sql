-- db/migrations/028_drafts.sql
-- Suporte a rascunhos (draft) e soft delete em cursos
-- Mantém compatibilidade sem afetar cursos existentes (todos continuarão draft=false).

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS draft boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Índice de cursos ativos (consulta pública):
-- Usa expressão parcial para acelerar filtros frequentes.
CREATE INDEX IF NOT EXISTS courses_active_idx
  ON courses(active)
  WHERE draft = false AND deleted_at IS NULL;
