// src/server/lib/course-clone.ts
import type { PoolClient } from "pg";

/**
 * Sanitiza payload_ref quando blankMedia=true.
 * Remove campos específicos de mídia / conteúdo pesado deixando estrutura mínima.
 */
function sanitizePayloadRef(obj: any): any {
  if (!obj || typeof obj !== "object") return {};
  const clone = JSON.parse(JSON.stringify(obj));
  // Campos comuns que queremos limpar se blankMedia=true:
  const mediaKeys = [
    "mux_playback_id",
    "mux_asset_id",
    "doc_id",
    "html",
    "url"
  ];
  for (const k of mediaKeys) {
    if (k in clone) {
      // Substitui por placeholder simples para manter formato.
      delete clone[k];
    }
  }
  return clone;
}

export interface CloneOptions {
  newSlug: string;
  newTitle: string;
  mode: "clone" | "template";
  blankMedia?: boolean;
  includeQuestions?: boolean;
}

/**
 * Clona um curso existente (estrutura: módulos, itens, quiz, questões)
 * - Preserva ordem
 * - Gera novos IDs
 * - Define draft=true no novo curso
 * - blankMedia: limpa payload_ref de itens (mantém somente estrutura)
 * - includeQuestions: clona questões do quiz
 */
export async function cloneCourse(
  c: PoolClient,
  sourceCourseId: string,
  opts: CloneOptions
) {
  const {
    newSlug,
    newTitle,
    mode,
    blankMedia = false,
    includeQuestions = true,
  } = opts;

  // Verifica slug único antes da transação
  {
    const dupe = await c.query(
      `SELECT 1 FROM courses WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
      [newSlug]
    );
    if (dupe.rowCount) {
      throw new Error("duplicate_slug");
    }
  }

  // Coleta estrutura do curso origem
  const courseRes = await c.query(
    `SELECT id, slug, title, summary, level, active FROM courses WHERE id = $1 AND deleted_at IS NULL`,
    [sourceCourseId]
  );
  if (!courseRes.rowCount) throw new Error("source_course_not_found");
  const sourceCourse = courseRes.rows[0];

  const modulesRes = await c.query(
    `SELECT id, title, "order" FROM modules WHERE course_id = $1 ORDER BY "order" ASC`,
    [sourceCourseId]
  );

  const itemsRes = await c.query(
    `SELECT id, module_id, type, "order", payload_ref
       FROM module_items
      WHERE module_id IN (
        SELECT id FROM modules WHERE course_id = $1
      )
      ORDER BY "order" ASC`,
    [sourceCourseId]
  );

  const quizRes = await c.query(
    `SELECT q.id, q.module_id, q.pass_score
       FROM quizzes q
       JOIN modules m ON m.id = q.module_id
      WHERE m.course_id = $1`,
    [sourceCourseId]
  );

  const questionsRes = quizRes.rowCount && includeQuestions
    ? await c.query(
        `SELECT id, quiz_id, kind, body, choices, answer_key
           FROM questions
          WHERE quiz_id IN (SELECT id FROM quizzes WHERE module_id IN (SELECT id FROM modules WHERE course_id = $1))
          ORDER BY id ASC`,
        [sourceCourseId]
      )
    : { rows: [] };

  // Inicia transação
  await c.query("BEGIN");

  try {
    // Novo curso (sempre draft=true; se mode=template, também active=false)
    const active = mode === "template" ? false : false; // sempre false no início
    const summary = sourceCourse.summary || "";
    const level = sourceCourse.level || "beginner";

    const newCourseRes = await c.query(
      `INSERT INTO courses(id, slug, title, summary, level, active, draft)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true)
       RETURNING id, slug, title, draft, active`,
      [newSlug, newTitle, summary, level, active]
    );
    const newCourse = newCourseRes.rows[0];
    const newCourseId = newCourse.id;

    // Map de moduleId antigo -> novo
    const moduleIdMap = new Map<string, string>();
    const newModules: any[] = [];

    for (const m of modulesRes.rows) {
      const nmRes = await c.query(
        `INSERT INTO modules(id, course_id, title, "order")
         VALUES (gen_random_uuid(), $1, $2, $3)
         RETURNING id, title, "order"`,
        [newCourseId, m.title, m.order]
      );
      const nm = nmRes.rows[0];
      moduleIdMap.set(m.id, nm.id);
      newModules.push(nm);
    }

    // Itens
    const newItemsByModule: Record<string, any[]> = {};
    for (const it of itemsRes.rows) {
      const newModuleId = moduleIdMap.get(it.module_id);
      if (!newModuleId) continue;
      const payloadRef = blankMedia
        ? sanitizePayloadRef(it.payload_ref)
        : it.payload_ref || {};

      const niRes = await c.query(
        `INSERT INTO module_items(id, module_id, type, "order", payload_ref)
         VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb)
         RETURNING id, type, "order"`,
        [newModuleId, it.type, it.order, JSON.stringify(payloadRef)]
      );
      const ni = niRes.rows[0];
      if (!newItemsByModule[newModuleId]) newItemsByModule[newModuleId] = [];
      newItemsByModule[newModuleId].push(ni);
    }

    // Quiz + questões
    const newQuizIds: Record<string, string> = {};
    let questionsCopied = 0;

    for (const q of quizRes.rows) {
      const newModuleId = moduleIdMap.get(q.module_id);
      if (!newModuleId) continue;
      const nqRes = await c.query(
        `INSERT INTO quizzes(id, module_id, pass_score)
         VALUES (gen_random_uuid(), $1, $2)
         RETURNING id`,
        [newModuleId, q.pass_score]
      );
      const newQuizId = nqRes.rows[0].id;
      newQuizIds[newModuleId] = newQuizId;

      if (includeQuestions) {
        const subset = questionsRes.rows.filter((qq) => qq.quiz_id === q.id);
        for (const qq of subset) {
          await c.query(
            `INSERT INTO questions(id, quiz_id, kind, body, choices, answer_key)
             VALUES (gen_random_uuid(), $1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
            [
              newQuizId,
              qq.kind,
              JSON.stringify(qq.body || {}),
              JSON.stringify(qq.choices || []),
              JSON.stringify(qq.answer_key || {}),
            ]
          );
          questionsCopied++;
        }
      }
    }

    await c.query("COMMIT");

    return {
      course: newCourse,
      modules: newModules,
      items: newItemsByModule,
      quiz: newQuizIds,
      questionsCopied,
      blankMedia,
      includeQuestions,
      mode,
    };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

/**
 * Publica um curso (draft -> ativo).
 * Regras simples: curso existe e não está deletado, está em draft.
 */
export async function publishCourse(c: PoolClient, courseId: string) {
  const r = await c.query(
    `UPDATE courses
        SET draft = false,
            active = true
      WHERE id = $1
        AND draft = true
        AND deleted_at IS NULL
      RETURNING id, slug, title, draft, active`,
    [courseId]
  );
  if (!r.rowCount) throw new Error("cannot_publish");
  return r.rows[0];
}

/**
 * Soft delete de curso em draft sem entitlements.
 */
export async function deleteDraftCourse(c: PoolClient, courseId: string) {
  // Verifica se é draft e sem entitlements
  const check = await c.query(
    `SELECT
       c.id,
       c.draft,
       c.deleted_at,
       (SELECT COUNT(*) FROM entitlements e WHERE e.course_id = c.id) AS ent_count
     FROM courses c
    WHERE c.id = $1`,
    [courseId]
  );
  if (!check.rowCount) throw new Error("not_found");
  const row = check.rows[0];
  if (!row.draft || row.deleted_at) throw new Error("not_draft");
  if (Number(row.ent_count) > 0) throw new Error("has_entitlements");

  const del = await c.query(
    `UPDATE courses
        SET deleted_at = now()
      WHERE id = $1
        AND draft = true
        AND deleted_at IS NULL
      RETURNING id, slug, title, deleted_at`,
    [courseId]
  );
  if (!del.rowCount) throw new Error("delete_failed");
  return del.rows[0];
}
