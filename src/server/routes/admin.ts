// src/server/routes/admin.ts
import { Router, Request, Response } from "express";
import { pool, withClient } from "../lib/db.js";
import { z } from "zod";
import { isUuid, paramUuid } from "../utils/ids.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { issueCertificate } from "../lib/certificates.js";

const router = Router();

// POST /api/admin/certificates/:userId/:courseId/issue?force=1&reissue=1&keepIssuedAt=1&fullName=...
router.post(
  "/certificates/:userId/:courseId/issue",
  requireAuth,
  requireAdmin,
  paramUuid("userId"),
  paramUuid("courseId"),
  async (req, res) => {
    const { userId, courseId } = req.params as { userId: string; courseId: string };
    const force = String(req.query.force ?? "") === "1";
    const reissue = String(req.query.reissue ?? "") === "1";
    const keepIssuedAt = String(req.query.keepIssuedAt ?? "") === "1";
    const fullNameQ =
      typeof req.query.fullName === "string" ? req.query.fullName.trim() : undefined;
    const fullName = fullNameQ && fullNameQ.length > 0 ? fullNameQ : undefined;
    if (!isUuid(userId) || !isUuid(courseId)) {
      return res.status(400).json({ error: "invalid_ids" });
    }
    if (!force) {
      return res.status(400).json({ error: "force_required" });
    }

    try {
      const row = await withClient((client) =>
        issueCertificate({
          client,
          userId,
          courseId,
          reissue,
          keepIssuedAt,
          fullName,
        })
      );

      const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host") ?? ""}`;
      const verifyUrl = row.serial ? `${base}/api/certificates/verify/${row.serial}` : null;

      res.json({
        id: row.id,
        user_id: row.user_id,
        course_id: row.course_id,
        issued_at: row.issued_at,
        pdf_url: row.pdf_url,
        serial: row.serial ?? null,
        hash: row.hash ?? null,
        verifyUrl: row.verifyUrl,
        forced: true,
        reissue,
        keepIssuedAt,
      });
    } catch (e: any) {
      console.error("POST /api/admin/certificates.../issue error", e);
      if (process.env.DEBUG_CERTS === "1") {
        return res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
      }
      res.status(500).json({ error: "server_error" });
    }
  }
);

const AdminEntitlementBody = z
  .object({
    userId: z.string().uuid(),
    courseId: z.string().uuid().optional(),
    trackId: z.string().uuid().optional(),
    source: z.string().min(1).default("grant"),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    revoke: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.courseId || v.trackId), {
    message: "Either courseId or trackId is required",
  });

const AdminUserBody = z.object({
  email: z.string().trim().toLowerCase().email(),
});

const AdminUserSearchQuery = z.object({
  email: z.string().trim().min(3, "Informe ao menos 3 caracteres"),
});

// ========= Rotas "underscore" SEM guards :id =========
// Mantê-las ANTES de qualquer router.use("/.../:id", paramUuid("id"))

// Cursos com contagens (mantém UMA única definição; removidas duplicatas)
router.get("/courses/_summary", async (_req: Request, res: Response) => {
  const q = await pool.query(`
    SELECT c.id, c.slug, c.title, c.summary, c.level, c.active,
           COUNT(DISTINCT m.id) AS module_count,
           COUNT(mi.id)         AS item_count
      FROM courses c
      LEFT JOIN modules m      ON m.course_id = c.id
      LEFT JOIN module_items mi ON mi.module_id = m.id
     GROUP BY c.id
     ORDER BY c.title ASC
  `);
  res.json({ courses: q.rows });
});

// Cursos somente em rascunho (auxílio administrativo)
router.get("/courses/_drafts", async (_req: Request, res: Response) => {
  const { rows } = await pool.query(
    `
    select id, slug, title, summary, level, active, draft, created_at
      from courses
     where draft = true
       and deleted_at is null
     order by created_at desc
    `
  );
  res.json({ courses: rows });
});

// Trilhas (tracks) resumo (mantém UMA única definição; removidas duplicatas)
router.get("/tracks/_summary", async (_req: Request, res: Response) => {
  const q = await pool.query(`
    SELECT t.id, t.slug, t.title, t.active,
           COUNT(tc.course_id) AS course_count
      FROM tracks t
      LEFT JOIN track_courses tc ON tc.track_id = t.id
     GROUP BY t.id
     ORDER BY t.title ASC
  `);
  res.json({ tracks: q.rows });
});

// (Mantida a primeira definição de /users/_search mais abaixo; removida duplicada)
// (Mantida a primeira definição de POST /users mais abaixo; removida duplicada)

// Conceder/Revogar entitlements
router.post("/entitlements", async (req, res) => {
  try {
    const parsed = AdminEntitlementBody.parse(req.body ?? {});
    const { userId, courseId, trackId, source, startsAt, endsAt, revoke } = parsed;

    if (revoke) {
      await pool.query(
        `UPDATE entitlements
            SET ends_at = now()
          WHERE user_id = $1
            AND COALESCE(course_id::text,'') = COALESCE($2,'')
            AND COALESCE(track_id::text,'') = COALESCE($3,'')
            AND now() < COALESCE(ends_at,'9999-12-31'::timestamptz)`,
        [userId, courseId || null, trackId || null]
      );
      return res.json({ ok: true, action: "revoked" });
    }

    // UPSERT por (user_id, course_id) quando há curso; senão, por (user_id, track_id)
    const conflict =
      courseId
        ? "ON CONFLICT (user_id, course_id) DO UPDATE SET source=EXCLUDED.source, starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at"
        : "ON CONFLICT (user_id, track_id) DO UPDATE SET source=EXCLUDED.source, starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at";

    const params = [userId, courseId || null, trackId || null, source || "grant", startsAt || null, endsAt || null];
    const { rows } = await pool.query(
      `INSERT INTO entitlements(id, user_id, course_id, track_id, source, starts_at, ends_at, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, COALESCE($4,'grant'), COALESCE($5::timestamptz, now()), $6::timestamptz, now())
       ${conflict}
       RETURNING id, user_id, course_id, track_id, source, starts_at, ends_at, created_at`,
      params
    );
    res.json({ ok: true, entitlement: rows[0] });
  } catch (e: any) {
    if (e?.name === "ZodError") {
      const { fieldErrors, formErrors } = e.flatten();
      return res.status(400).json({ error: { fieldErrors, formErrors } });
    }
    console.error("POST /admin/entitlements error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// --- Underscore extras sem :id ---
router.get("/users/_search", async (req, res) => {
  const maybeEmail = Array.isArray(req.query.email) ? req.query.email[0] : req.query.email;
  const parsed = AdminUserSearchQuery.safeParse({ email: maybeEmail ?? "" });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const term = parsed.data.email.toLowerCase();
  const sanitized = term.replace(/[%_]/g, "\\$&");
  const pattern = `%${sanitized}%`;

  const { rows } = await pool.query(
    `
      select id, email
        from users
       where email ilike $1 escape '\\'
       order by email asc
       limit 20
    `,
    [pattern]
  );
  res.json({ users: rows });
});

// (removido daqui) Guards com :id serão registrados mais abaixo,
// DEPOIS das rotas literais como /courses/import, /courses/_summary e /courses/_drafts


router.post("/users", async (req, res) => {
  const parsed = AdminUserBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const q = await pool.query(
      `
      insert into users(id, email)
      values (gen_random_uuid(), $1)
      on conflict (email) do update set email = excluded.email
      returning id, email
    `,
      [parsed.data.email]
    );

    return res.json({ user: q.rows[0] });
  } catch (err) {
    console.error("POST /admin/users error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// === Courses: módulos de um curso (para o dropdown do Studio/DnD)
router.get("/courses/:courseId/modules", async (req: Request, res: Response) => {
  const { courseId } = req.params;
  if (!isUuid(courseId)) {
    return res.status(400).json({ error: "invalid_course_id", courseId });
  }

  const mods = await pool.query(
    `SELECT id, title, "order"
       FROM modules
      WHERE course_id = $1
      ORDER BY "order" ASC, title ASC`,
    [courseId]
  );
  res.json({ modules: mods.rows });
});

// GET /admin/modules/:id/items  → lista itens (id, type, order) do módulo
router.get("/modules/:id/items", async (req, res) => {
  const moduleId = String(req.params.id || "");
  if (!isUuid(moduleId)) {
    return res.status(400).json({ error: "invalid_module_id" });
  }
  const mod = await pool.query(`SELECT id FROM modules WHERE id = $1`, [moduleId]);
  if (mod.rowCount === 0) return res.status(404).json({ error: "module_not_found" });

  const items = await pool.query(
    `
    SELECT id, module_id, type, "order", payload_ref
      FROM module_items
     WHERE module_id = $1
     ORDER BY "order" ASC, id ASC
    `,
    [moduleId]
  );
  // payload_ref já vem como jsonb → o driver devolve como objeto JS
  return res.json({ items: items.rows });
});

// POST /api/admin/items/:itemId/move
// Body: { targetModuleId: uuid, newOrder?: number }
router.post("/items/:itemId/move", async (req, res) => {
  const itemId = String(req.params.itemId || "").trim();
  if (!isUuid(itemId)) return res.status(400).json({ error: "invalid_item_id" });
  const targetModuleId = String(req.body?.targetModuleId || "").trim();
  const newOrderRaw = req.body?.newOrder;
  const newOrderParsed = Number(newOrderRaw);
  const newOrder =
    Number.isInteger(newOrderParsed) && newOrderParsed > 0 ? newOrderParsed : null;
  if (!isUuid(targetModuleId)) {
    return res.status(400).json({ error: "invalid_target_module" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const itemQ = await client.query(
      `select id, module_id, type from module_items where id = $1 limit 1`,
      [itemId]
    );
    if (!itemQ.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "item_not_found" });
    }
    const item = itemQ.rows[0];

    const originModuleQ = await client.query(
      `select id, course_id from modules where id = $1`,
      [item.module_id]
    );
    const targetModuleQ = await client.query(
      `select id, course_id from modules where id = $1`,
      [targetModuleId]
    );
    if (!originModuleQ.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "origin_module_not_found" });
    }
    if (!targetModuleQ.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "target_module_not_found" });
    }
    const originCourseId = originModuleQ.rows[0].course_id;
    const targetCourseId = targetModuleQ.rows[0].course_id;
    if (originCourseId !== targetCourseId) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "cross_course" });
    }

    if (item.type === "quiz" && item.module_id !== targetModuleId) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "cannot_move_quiz" });
    }

    const sameModule = item.module_id === targetModuleId;

    if (sameModule) {
      if (newOrder === null) {
        await client.query("ROLLBACK");
        return res.json({ ok: true, action: "noop_same_module" });
      }

      const itsQ = await client.query(
        `select id, "order" from module_items where module_id = $1 order by "order" asc, id asc`,
        [targetModuleId]
      );
      const ids = itsQ.rows.map((r: any) => r.id);
      if (!ids.includes(itemId)) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "item_not_in_module" });
      }

      const filtered = ids.filter((id: string) => id !== itemId);
      const pos = Math.max(0, Math.min(newOrder - 1, filtered.length));
      filtered.splice(pos, 0, itemId);

      await client.query(
        `update module_items set "order" = "order" + 1000 where module_id = $1`,
        [targetModuleId]
      );
      for (let i = 0; i < filtered.length; i += 1) {
        await client.query(`update module_items set "order" = $1 where id = $2`, [i + 1, filtered[i]]);
      }
      await client.query("COMMIT");
      return res.json({ ok: true, action: "reordered", moduleId: targetModuleId });
    }

    const targetItemsQ = await client.query(
      `select id from module_items where module_id = $1 order by "order" asc, id asc`,
      [targetModuleId]
    );
    const count = targetItemsQ.rowCount;
    const finalOrder =
      newOrder !== null ? Math.min(Math.max(newOrder, 1), count + 1) : count + 1;

    await client.query(
      `update module_items
          set "order" = "order" + 1
        where module_id = $1
          and "order" >= $2`,
      [targetModuleId, finalOrder]
    );

    const upd = await client.query(
      `update module_items
          set module_id = $1,
              "order" = $2
        where id = $3
        returning id, module_id, type, "order"`,
      [targetModuleId, finalOrder, itemId]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, action: "moved", item: upd.rows[0] });
  } catch (e: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ error: "move_failed", detail: String(e?.message || e) });
  } finally {
    client.release();
  }
});

// GET /api/admin/courses/:courseId/export
router.get("/courses/:courseId/export", async (req, res) => {
  const courseId = String(req.params.courseId || "");
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_courseId" });
  const sanitize = String(req.query.sanitize || "") === "1";
  const blankMedia = String(req.query.blankMedia || "") === "1";
  const dropIds = String(req.query.dropIds || "") === "1";

  const client = await pool.connect();
  try {
    const courseQ = await client.query(
      `select id, slug, title, summary, level, active, draft, deleted_at
         from courses
        where id = $1
        limit 1`,
      [courseId]
    );
    if (!courseQ.rowCount) return res.status(404).json({ error: "course_not_found" });
    const course = courseQ.rows[0];

    const modulesQ = await client.query(
      `select id, title, "order"
         from modules
        where course_id = $1
        order by "order" asc, id asc`,
      [courseId]
    );
    const moduleIds = modulesQ.rows.map((m: any) => m.id);

    const itemsQ = moduleIds.length
      ? await client.query(
          `select id, module_id, type, "order", payload_ref
             from module_items
            where module_id = any($1::uuid[])
            order by module_id, "order", id`,
          [moduleIds]
        )
      : { rows: [] };

    const quizzesQ = moduleIds.length
      ? await client.query(
          `select id, module_id, pass_score
             from quizzes
            where module_id = any($1::uuid[])`,
          [moduleIds]
        )
      : { rows: [] };

    const quizIds = quizzesQ.rows.map((q: any) => q.id);
    const questionsQ = quizIds.length
      ? await client.query(
          `select id, quiz_id, kind, body, choices, answer_key
             from questions
            where quiz_id = any($1::uuid[])
            order by id`,
          [quizIds]
        )
      : { rows: [] };

    const questionsByQuiz = new Map<string, any[]>();
    for (const qs of questionsQ.rows) {
      const arr = questionsByQuiz.get(qs.quiz_id) || [];
      arr.push({
        id: qs.id,
        kind: qs.kind,
        body: qs.body || {},
        choices: qs.choices || [],
        answerKey: qs.answer_key || null,
      });
      questionsByQuiz.set(qs.quiz_id, arr);
    }

    const mediaKeys = ["mux_playback_id", "mux_asset_id", "doc_id", "html", "url"];
    const cleanPayload = (ref: any) => {
      if (!ref || typeof ref !== "object") return {};
      const clone: Record<string, any> = { ...ref };
      if (blankMedia || sanitize) {
        for (const k of mediaKeys) {
          if (k in clone) delete clone[k];
        }
      }
      return clone;
    };

    const modules = modulesQ.rows.map((m: any) => {
      const its = itemsQ.rows
        .filter((it: any) => it.module_id === m.id)
        .map((it: any) => {
          const payloadRef = blankMedia || sanitize ? cleanPayload(it.payload_ref) : it.payload_ref || {};
          const base: Record<string, any> = {
            type: it.type,
            order: Number(it.order),
            payloadRef,
          };
          if (!dropIds) base.id = it.id;
          return base;
        });

      const quiz = quizzesQ.rows.find((q: any) => q.module_id === m.id);
      let quizObj;
      if (quiz) {
        quizObj = {
          passScore: Number(quiz.pass_score),
          questions: (questionsByQuiz.get(quiz.id) || []).map((q: any) => {
            const qBase: Record<string, any> = {
              kind: q.kind,
              body: q.body,
              choices: q.choices,
              answerKey: q.answerKey,
            };
            if (!dropIds) qBase.id = q.id;
            return qBase;
          }),
        };
        if (!dropIds) (quizObj as any).id = quiz.id;
      }

      const modBase: Record<string, any> = {
        title: m.title,
        order: Number(m.order),
        items: its,
      };
      if (!dropIds) modBase.id = m.id;
      if (quizObj) modBase.quiz = quizObj;
      return modBase;
    });

    const out = {
      course: {
        slug: course.slug,
        title: course.title,
        summary: course.summary,
        level: course.level,
        active: course.active,
        draft: course.draft,
      },
      modules,
    };
    if (!dropIds) {
      (out.course as any).id = course.id;
    }

    return res.json({ export: out, dropIds, blankMedia, sanitize });
  } catch (e: any) {
    return res.status(500).json({ error: "export_failed", detail: String(e?.message || e) });
  } finally {
    client.release();
  }
});

// ===== Schemas =====
const CourseBody = z.object({
  slug: z.string().min(3),
  title: z.string().min(3),
  summary: z.string().optional().default(""),
  level: z.string().optional().default("beginner"),
  active: z.boolean().optional().default(true),
});

const CourseUpdateBody = z
  .object({
    title: z.string().min(3).optional(),
    summary: z.string().optional(),
    level: z.string().min(2).optional(),
    active: z.boolean().optional(),
    slug: z.string().regex(/^[-a-z0-9]+$/).min(3).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "no_fields" });

const ModuleBody = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(1),
  order: z.number().int().nonnegative().default(0),
});

const ItemBody = z.object({
  moduleId: z.string().uuid(),
  type: z.enum(["video", "text", "quiz"]),
  order: z.number().int().nonnegative().default(0),
  payloadRef: z.record(z.any()).default({}),
});
const ItemUpdateBody = z
  .object({
    type: z.enum(["video", "text", "quiz"]).optional(),
    payloadRef: z.record(z.any()).optional(),
  })
  .refine((v) => v.type !== undefined || v.payloadRef !== undefined, {
    message: "no_fields",
  });

const QuizBody = z.object({
  moduleId: z.string().uuid(),
  passScore: z.number().min(0).max(100).default(70),
});

const QuestionBody = z.object({
  quizId: z.string().uuid(),
  kind: z.enum(["single", "multiple", "truefalse"]),
  body: z.record(z.any()),       // { prompt, media? }
  choices: z.array(z.object({ id: z.string(), text: z.string() })).default([]),
  answerKey: z.array(z.string()).or(z.boolean() as any),
});

const TrackBody = z.object({
  slug: z.string().min(3),
  title: z.string().min(3),
  active: z.boolean().optional().default(true),
});

const TrackCourseBody = z.object({
  trackId: z.string().uuid(),
  courseId: z.string().uuid(),
  order: z.number().int().nonnegative().default(0),
  required: z.boolean().default(true),
});

const PrereqBody = z.object({
  courseId: z.string().uuid(),
  requiredCourseId: z.string().uuid(),
});

// ===== Cursos =====
router.post("/courses", async (req: Request, res: Response) => {
  const parsed = CourseBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const c = parsed.data;
  const { rows } = await pool.query(
    `insert into courses(slug,title,summary,level,active)
     values ($1,$2,$3,$4,$5)
     on conflict (slug) do update set title=excluded.title, summary=excluded.summary, level=excluded.level, active=excluded.active
     returning *`,
    [c.slug, c.title, c.summary, c.level, c.active]
  );
  res.json(rows[0]);
});

router.get("/courses", async (_req, res) => {
  const { rows } = await pool.query(
    `select id, slug, title, summary, level, active, created_at from courses order by created_at desc`
  );
  res.json(rows);
});

router.patch("/courses/:courseId", async (req, res) => {
  const courseId = String(req.params.courseId || "");
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_courseId" });

  const parsed = CourseUpdateBody.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const fields: string[] = [];
  const values: any[] = [];

  if (data.slug !== undefined) {
    const dupe = await pool.query(
      `select 1 from courses where slug = $1 and id <> $2 and deleted_at is null limit 1`,
      [data.slug, courseId]
    );
    if (dupe.rowCount) {
      return res.status(409).json({ error: "duplicate_slug" });
    }
    fields.push(`slug = $${fields.length + 1}`);
    values.push(data.slug);
  }
  if (data.title !== undefined) {
    fields.push(`title = $${fields.length + 1}`);
    values.push(data.title);
  }
  if (data.summary !== undefined) {
    fields.push(`summary = $${fields.length + 1}`);
    values.push(data.summary);
  }
  if (data.level !== undefined) {
    fields.push(`level = $${fields.length + 1}`);
    values.push(data.level);
  }
  if (data.active !== undefined) {
    fields.push(`active = $${fields.length + 1}`);
    values.push(data.active);
  }

  if (fields.length === 0) return res.status(400).json({ error: "no_fields" });

  values.push(courseId);
  const sql = `
    update courses
       set ${fields.join(", ")},
           updated_at = now()
     where id = $${values.length}
       and deleted_at is null
     returning id, slug, title, summary, level, active, draft, deleted_at
  `;

  try {
    const r = await pool.query(sql, values);
    if (!r.rowCount) return res.status(404).json({ error: "not_found_or_deleted" });
    return res.json({ course: r.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ error: "update_failed", detail: String(e?.message || e) });
  }
});

router.get("/courses/:courseId/full", async (req, res) => {
  const courseId = String(req.params.courseId || "");
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_courseId" });

  const client = await pool.connect();
  try {
    const courseQ = await client.query(
      `select id, slug, title, summary, level, active, draft, deleted_at, created_at
         from courses
        where id = $1
        limit 1`,
      [courseId]
    );
    if (!courseQ.rowCount) return res.status(404).json({ error: "course_not_found" });
    const course = courseQ.rows[0];

    const modulesQ = await client.query(
      `select id, title, "order"
         from modules
        where course_id = $1
        order by "order", id`,
      [courseId]
    );
    const moduleIds = modulesQ.rows.map((m) => m.id);

    const itemsQ = moduleIds.length
      ? await client.query(
          `select id, module_id, type, "order", payload_ref
             from module_items
            where module_id = any($1::uuid[])
            order by module_id, "order", id`,
          [moduleIds]
        )
      : { rows: [] };

    const quizzesQ = moduleIds.length
      ? await client.query(
          `select id, module_id, pass_score
             from quizzes
            where module_id = any($1::uuid[])`,
          [moduleIds]
        )
      : { rows: [] };

    const quizIds = quizzesQ.rows.map((q) => q.id);
    const questionsQ = quizIds.length
      ? await client.query(
          `select id, quiz_id, kind, body, choices, answer_key
             from questions
            where quiz_id = any($1::uuid[])
            order by id`,
          [quizIds]
        )
      : { rows: [] };

    const itemsByModule = new Map<string, any[]>();
    for (const it of itemsQ.rows) {
      const bucket = itemsByModule.get(it.module_id) || [];
      bucket.push({
        id: it.id,
        type: it.type,
        order: Number(it.order),
        payloadRef: it.payload_ref || {},
      });
      itemsByModule.set(it.module_id, bucket);
    }

    const quizById = new Map<string, any>();
    for (const quiz of quizzesQ.rows) {
      quizById.set(quiz.id, {
        id: quiz.id,
        moduleId: quiz.module_id,
        passScore: Number(quiz.pass_score),
        questions: [],
      });
    }
    for (const qs of questionsQ.rows) {
      const target = quizById.get(qs.quiz_id);
      if (!target) continue;
      target.questions.push({
        id: qs.id,
        kind: qs.kind,
        body: qs.body || {},
        choices: qs.choices || [],
        answerKey: qs.answer_key ?? null,
      });
    }

    const quizByModule = new Map<string, any>();
    for (const quiz of quizById.values()) {
      const { moduleId, ...rest } = quiz;
      quizByModule.set(moduleId, rest);
    }

    const modules = modulesQ.rows.map((m) => {
      const items = itemsByModule.get(m.id) || [];
      return {
        id: m.id,
        title: m.title,
        order: Number(m.order),
        itemCount: items.length,
        items,
        quiz: quizByModule.get(m.id) ?? null,
      };
    });

    return res.json({ course, modules });
  } catch (e: any) {
    return res.status(500).json({ error: "full_fetch_failed", detail: String(e?.message || e) });
  } finally {
    client.release();
  }
});

router.post("/courses/:courseId/restore", async (req, res) => {
  const courseId = String(req.params.courseId || "");
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_courseId" });
  try {
    const r = await pool.query(
      `update courses
          set deleted_at = null,
              updated_at = now()
        where id = $1
          and deleted_at is not null
          and draft = true
        returning id, slug, title, draft, deleted_at`,
      [courseId]
    );
    if (!r.rowCount) return res.status(409).json({ error: "cannot_restore" });
    return res.json({ ok: true, course: r.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ error: "restore_failed", detail: String(e?.message || e) });
  }
});

/**
 * POST /api/admin/courses/import
 * Importa um curso completo a partir de JSON.
 * Body:
 * {
 *   simulate?: boolean,
 *   blankMedia?: boolean,
 *   course: { slug, title, summary?, level?, active? },
 *   modules: [
 *     {
 *       title,
 *       items?: [{ type, payloadRef? }],
 *       quiz?: { passScore?, questions?: [{ kind, body, choices, answerKey }] }
 *     }, ...
 *   ]
 * }
 */
router.post("/courses/import", async (req: Request, res: Response) => {
  const body = req.body || {};
  const simulate = Boolean(body.simulate) || String(req.query.simulate || "") === "1";
  const blankMedia = Boolean(body.blankMedia);
  const course = body.course || {};
  const modules = Array.isArray(body.modules) ? body.modules : [];

  // Validar campos mínimos
  if (!course.slug || !course.title) {
    return res.status(400).json({ error: "missing_course_fields" });
  }
  if (!/^[-a-z0-9]+$/.test(course.slug)) {
    return res.status(400).json({ error: "invalid_slug_format" });
  }
  if (!modules.length) {
    return res.status(400).json({ error: "no_modules" });
  }

  // Validar módulos / itens / quiz
  for (const [idx, m] of modules.entries()) {
    if (!m || typeof m.title !== "string" || !m.title.trim()) {
      return res.status(400).json({ error: "module_title_required", moduleIndex: idx });
    }
    if (m.items && !Array.isArray(m.items)) {
      return res.status(400).json({ error: "module_items_must_be_array", moduleIndex: idx });
    }
    if (m.items) {
      for (const [iIdx, it] of m.items.entries()) {
        if (!it || !["video", "text", "quiz"].includes(it.type)) {
          return res.status(400).json({ error: "invalid_item_type", moduleIndex: idx, itemIndex: iIdx });
        }
      }
    }
    // Se vier item 'quiz' sem definição de quiz do módulo, rejeita (não teremos quizId novo para apontar)
    const hasQuizItem = Array.isArray(m.items) && m.items.some((it: any) => it?.type === "quiz");
    if (hasQuizItem && !m.quiz) {
      return res.status(400).json({ error: "quiz_item_without_quiz_def", moduleIndex: idx });
    }
    if (m.quiz) {
      const q = m.quiz;
      const passScore = q.passScore == null ? 70 : Number(q.passScore);
      if (!Number.isFinite(passScore) || passScore < 0 || passScore > 100) {
        return res.status(400).json({ error: "invalid_pass_score", moduleIndex: idx });
      }
      if (q.questions && !Array.isArray(q.questions)) {
        return res.status(400).json({ error: "quiz_questions_must_be_array", moduleIndex: idx });
      }
      if (Array.isArray(q.questions)) {
        for (const [qi, qq] of q.questions.entries()) {
          if (!qq || !["single", "multiple", "truefalse"].includes(String(qq.kind))) {
            return res.status(400).json({ error: "invalid_question_kind", moduleIndex: idx, questionIndex: qi });
          }
        }
      }
    }
  }

  const client = await pool.connect();
  try {
    // Checar slug duplicado
    const dupe = await client.query(
      `select 1 from courses where slug = $1 and deleted_at is null limit 1`,
      [course.slug]
    );
    if (dupe.rowCount) {
      return res.status(409).json({ error: "duplicate_slug" });
    }

    // Simulação: não cria nada, só projeta
    if (simulate) {
      const projectedModules = modules.map((m, i) => ({
        tempId: `mod-${i + 1}`,
        title: m.title,
        order: i + 1,
        itemCount:
          (m.items || []).length +
          // se há quiz definido e não há item "quiz", projetamos um item quiz extra
          (m.quiz && !(m.items || []).some((it: any) => it?.type === "quiz") ? 1 : 0),
        quiz: m.quiz
          ? {
              passScore: m.quiz.passScore == null ? 70 : Number(m.quiz.passScore),
              questionCount: Array.isArray(m.quiz.questions) ? m.quiz.questions.length : 0,
            }
          : undefined,
      }));
      const projectedItems: Record<string, any[]> = {};
      projectedModules.forEach((pm, idx) => {
        const modDef = modules[idx] || {};
        const base = (modDef.items || []).map((it: any, itIdx: number) => ({
          type: it.type,
          order: itIdx + 1,
          payloadPreview: blankMedia ? "cleared" : "kept",
        }));
        // se há quiz definido e nenhum item quiz no array, adiciona um "quiz item" projetado
        const needsQuizItem = !!modDef.quiz && !(modDef.items || []).some((it: any) => it?.type === "quiz");
        const its = needsQuizItem
          ? [...base, { type: "quiz", order: base.length + 1, payloadPreview: "quizId:new" }]
          : base;
        projectedItems[pm.tempId] = its;
      });
      const quizQuestionsTotal = modules.reduce((sum, m) => {
        const qs = m.quiz?.questions;
        return sum + (Array.isArray(qs) ? qs.length : 0);
      }, 0);

      return res.json({
        simulate: true,
        blankMedia: !!blankMedia,
        course: { slug: course.slug, title: course.title, draft: true },
        modules: projectedModules,
        items: projectedItems,
        quizQuestionsTotal,
      });
    }

    await client.query("BEGIN");

    // Inserir curso (draft=true, active conforme body.course.active ou false por padrão)
    const active = Boolean(course.active);
    const level = course.level || "beginner";
    const summary = course.summary || "";
    const newCourseRes = await client.query(
      `insert into courses(id, slug, title, summary, level, active, draft)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, true)
       returning id, slug, title, draft, active`,
      [course.slug, course.title, summary, level, active]
    );
    const newCourse = newCourseRes.rows[0];
    const newCourseId = newCourse.id;

    // Sanitizar payload_ref se blankMedia
    function sanitize(ref: any) {
      if (!blankMedia) return ref || {};
      if (!ref || typeof ref !== "object") return {};
      const clone = { ...ref };
      for (const k of ["mux_playback_id", "mux_asset_id", "doc_id", "html", "url"]) {
        if (k in clone) delete (clone as any)[k];
      }
      return clone;
    }

    // Inserir módulos + itens + quiz + perguntas
    const newModules: any[] = [];
    const newItemsByModule: Record<string, any[]> = {};
    const newQuizIds: Record<string, string> = {};
    let questionsCreated = 0;

    for (let i = 0; i < modules.length; i++) {
      const m = modules[i];
      const mRes = await client.query(
        `insert into modules(id, course_id, title, "order")
         values (gen_random_uuid(), $1, $2, $3)
         returning id, title, "order"`,
        [newCourseId, m.title, i + 1]
      );
      const newModuleId = mRes.rows[0].id;
      newModules.push(mRes.rows[0]);

      // Quiz opcional — cria primeiro para ter quizId disponível aos itens "quiz"
      let quizId: string | null = null;
      if (m.quiz) {
        const passScore = m.quiz.passScore == null ? 70 : Number(m.quiz.passScore);
        const qRes = await client.query(
          `insert into quizzes(id, module_id, pass_score)
           values (gen_random_uuid(), $1, $2)
           returning id`,
          [newModuleId, passScore]
        );
        quizId = qRes.rows[0].id;
        newQuizIds[newModuleId] = quizId;

        const questionsDef = Array.isArray(m.quiz.questions) ? m.quiz.questions : [];
        for (const qq of questionsDef) {
          await client.query(
            `insert into questions(id, quiz_id, kind, body, choices, answer_key)
             values (gen_random_uuid(), $1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
            [
              quizId,
              qq.kind,
              JSON.stringify(qq.body || {}),
              JSON.stringify(qq.choices || []),
              JSON.stringify(qq.answerKey || {}),
            ]
          );
          questionsCreated++;
        }
      }

      // Itens — insere e garante item "quiz" atrelado ao quizId (se houver quiz definido)
      const itemsDef = m.items || [];
      let insertedQuizItem = false;
      for (let itIdx = 0; itIdx < itemsDef.length; itIdx++) {
        const it = itemsDef[itIdx];
        let payloadRef = sanitize(it.payloadRef);
        if (it.type === "quiz") {
          // força o vínculo com o quiz recém-criado
          if (!quizId) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "quiz_item_without_quiz_def", moduleIndex: i });
          }
          payloadRef = { ...(payloadRef || {}), quiz_id: quizId };
          insertedQuizItem = true;
        }
        const iRes = await client.query(
          `insert into module_items(id, module_id, type, "order", payload_ref)
           values (gen_random_uuid(), $1, $2, $3, $4::jsonb)
           returning id, type, "order"`,
          [newModuleId, it.type, itIdx + 1, JSON.stringify(payloadRef)]
        );
        if (!newItemsByModule[newModuleId]) newItemsByModule[newModuleId] = [];
        newItemsByModule[newModuleId].push(iRes.rows[0]);
      }
      // Se há quiz definido e nenhum item "quiz" foi fornecido, cria um automaticamente no final
      if (quizId && !insertedQuizItem) {
        const order = (itemsDef?.length || 0) + 1;
        const iRes = await client.query(
          `insert into module_items(id, module_id, type, "order", payload_ref)
           values (gen_random_uuid(), $1, 'quiz', $2, $3::jsonb)
           returning id, type, "order"`,
          [newModuleId, order, JSON.stringify({ quiz_id: quizId })]
        );
        if (!newItemsByModule[newModuleId]) newItemsByModule[newModuleId] = [];
        newItemsByModule[newModuleId].push(iRes.rows[0]);
      }
    }

    await client.query("COMMIT");
    return res.json({
      simulate: false,
      course: newCourse,
      modules: newModules,
      items: newItemsByModule,
      quiz: newQuizIds,
      questionsCreated,
      blankMedia: !!blankMedia,
    });
  } catch (e: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    const msg = String(e?.message || e);
    if (msg === "duplicate_slug") return res.status(409).json({ error: "duplicate_slug" });
    return res.status(500).json({ error: "import_failed", detail: msg });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/courses/:courseId/clone
 * Clona estrutura de um curso (módulos, itens, quiz e perguntas).
 * Body: { newSlug, newTitle, mode="clone"|"template", blankMedia?:boolean, includeQuestions?:boolean }
 * - Novo curso nasce draft=true, active=false
 * - blankMedia: remove campos de mídia (ex.: mux_playback_id, html, url, doc_id) do payload_ref dos itens
 * - includeQuestions: clona perguntas dos quizzes
 */
router.post("/courses/:courseId/clone", async (req, res) => {
  const sourceId = String(req.params.courseId || "").trim();
  if (!isUuid(sourceId)) return res.status(400).json({ error: "invalid_courseId" });
  const {
    newSlug,
    newTitle,
    mode = "clone",
    blankMedia = false,
    includeQuestions = true,
    simulate: simulateBody,
  } = req.body || {};
  // também aceita via query: ?simulate=1
  const simulate = Boolean(simulateBody) || String(req.query.simulate || "") === "1";
  if (!newSlug || !newTitle) {
    return res.status(400).json({ error: "missing_newSlug_or_newTitle" });
  }
  if (!/^[-a-z0-9]+$/.test(newSlug)) {
    return res.status(400).json({ error: "invalid_slug_format" });
  }
  if (!["clone", "template"].includes(mode)) {
    return res.status(400).json({ error: "invalid_mode" });
  }

  const client = await pool.connect();
  try {
    // Slug não pode existir nem em draft nem publicado
    const dupe = await client.query(
      `select 1 from courses where slug = $1 and deleted_at is null limit 1`,
      [newSlug]
    );
    if (dupe.rowCount) {
      return res.status(409).json({ error: "duplicate_slug" });
    }

    // Carrega curso de origem válido (não deletado)
    const courseOrig = await client.query(
      `select id, slug, title, summary, level
         from courses
        where id = $1
          and deleted_at is null
        limit 1`,
      [sourceId]
    );
    if (!courseOrig.rowCount) {
      return res.status(404).json({ error: "source_course_not_found" });
    }
    const source = courseOrig.rows[0];

    // Módulos em ordem
    const modules = await client.query(
      `select id, title, "order"
         from modules
        where course_id = $1
        order by "order" asc, id asc`,
      [sourceId]
    );

    // Itens do curso de origem (CORREÇÃO: usar IN (SELECT ...) — NÃO usar ANY(subquery))
    const items = await client.query(
      `select id, module_id, type, "order", payload_ref
         from module_items
        where module_id in (select id from modules where course_id = $1)
        order by module_id, "order" asc`,
      [sourceId]
    );

    // Quizzes (por módulo) e, se habilitado, perguntas
    const quizzes = await client.query(
      `select q.id, q.module_id, q.pass_score
         from quizzes q
         join modules m on m.id = q.module_id
        where m.course_id = $1`,
      [sourceId]
    );
    let questions: any[] = [];
    if (quizzes.rowCount && includeQuestions) {
      const quizIds = quizzes.rows.map((q) => q.id);
      const qs = await client.query(
        `select id, quiz_id, kind, body, choices, answer_key
           from questions
          where quiz_id = any($1::uuid[])`,
        [quizIds]
      );
      questions = qs.rows;
    }

    // Se for simulação, apenas monta plano e retorna sem inserts
    if (simulate) {
      // Projeção dos IDs fictícios (não geramos realmente, apenas preview)
      const projectedModules = modules.rows.map((m) => ({
        tempId: `mod-${m.id.slice(0, 8)}-new`,
        title: m.title,
        order: m.order,
      }));
      const moduleTempMap = new Map<string, string>();
      projectedModules.forEach((pm, idx) => {
        moduleTempMap.set(modules.rows[idx].id, pm.tempId);
      });
      const projectedItems = modules.rows.reduce<Record<string, any[]>>((acc, m) => {
        const tempId = moduleTempMap.get(m.id);
        if (!tempId) return acc;
        const its = items.rows
          .filter((it) => it.module_id === m.id)
          .map((it) => ({
            type: it.type,
            order: it.order,
            payloadPreview: blankMedia ? "cleared" : "kept",
          }));
        acc[tempId] = its;
        return acc;
      }, {});
      const projectedQuiz = quizzes.rows.reduce<Record<string, string>>((acc, q) => {
        const tempId = moduleTempMap.get(q.module_id);
        if (tempId) acc[tempId] = `quiz-new-for-${tempId}`;
        return acc;
      }, {});
      return res.json({
        simulate: true,
        mode,
        blankMedia: !!blankMedia,
        includeQuestions: !!includeQuestions,
        newSlug,
        newTitle,
        sourceCourseId: sourceId,
        projected: {
          course: { slug: newSlug, title: newTitle, draft: true },
          modules: projectedModules,
          items: projectedItems,
          quiz: projectedQuiz,
          questionsCopied: includeQuestions ? questions.length : 0,
        },
      });
    }

    await client.query("BEGIN");

    // Insere novo curso (sempre draft=true, active=false)
    const newCourse = await client.query(
      `insert into courses(id, slug, title, summary, level, active, draft)
       values (gen_random_uuid(), $1, $2, $3, $4, false, true)
       returning id, slug, title, draft, active`,
      [newSlug, newTitle, source.summary || "", source.level || "beginner"]
    );
    const newCourseId = newCourse.rows[0].id;

    // Mapa de módulo antigo -> novo
    const moduleIdMap = new Map<string, string>();
    const newModules: any[] = [];
    for (const m of modules.rows) {
      const ins = await client.query(
        `insert into modules(id, course_id, title, "order")
         values (gen_random_uuid(), $1, $2, $3)
         returning id, title, "order"`,
        [newCourseId, m.title, m.order]
      );
      moduleIdMap.set(m.id, ins.rows[0].id);
      newModules.push(ins.rows[0]);
    }

    // Sanitização leve de payload_ref quando blankMedia=true
    function sanitizePayloadRef(ref: any) {
      if (!blankMedia) return ref || {};
      if (!ref || typeof ref !== "object") return {};
      const clone = { ...ref };
      for (const k of ["mux_playback_id", "mux_asset_id", "doc_id", "html", "url"]) {
        if (k in clone) delete (clone as any)[k];
      }
      return clone;
    }

    // Itens
    const newItemsByModule: Record<string, any[]> = {};
    for (const it of items.rows) {
      const newModuleId = moduleIdMap.get(it.module_id);
      if (!newModuleId) continue;
      const payloadRef = sanitizePayloadRef(it.payload_ref);
      const ins = await client.query(
        `insert into module_items(id, module_id, type, "order", payload_ref)
         values (gen_random_uuid(), $1, $2, $3, $4::jsonb)
         returning id, type, "order"`,
        [newModuleId, it.type, it.order, JSON.stringify(payloadRef)]
      );
      if (!newItemsByModule[newModuleId]) newItemsByModule[newModuleId] = [];
      newItemsByModule[newModuleId].push(ins.rows[0]);
    }

    // Quizzes + perguntas
    const newQuizIds: Record<string, string> = {};
    let questionsCopied = 0;
    for (const q of quizzes.rows) {
      const newModuleId = moduleIdMap.get(q.module_id);
      if (!newModuleId) continue;
      const insQ = await client.query(
        `insert into quizzes(id, module_id, pass_score)
         values (gen_random_uuid(), $1, $2)
         returning id`,
        [newModuleId, q.pass_score]
      );
      const newQuizId = insQ.rows[0].id;
      newQuizIds[newModuleId] = newQuizId;

      if (includeQuestions) {
        const subset = questions.filter((qq) => qq.quiz_id === q.id);
        for (const qq of subset) {
          await client.query(
            `insert into questions(id, quiz_id, kind, body, choices, answer_key)
             values (gen_random_uuid(), $1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
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

    await client.query("COMMIT");
    return res.json({
      course: newCourse.rows[0],
      modules: newModules,
      items: newItemsByModule,
      quiz: newQuizIds,
      questionsCopied,
      blankMedia: !!blankMedia,
      includeQuestions: !!includeQuestions,
      mode,
      simulate: false,
    });
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    const msg = String(e?.message || e);
    if (msg === "duplicate_slug") return res.status(409).json({ error: "duplicate_slug" });
    if (msg === "source_course_not_found") return res.status(404).json({ error: "source_course_not_found" });
    return res.status(500).json({ error: "clone_failed", detail: msg });
  } finally {
    client.release();
  }
});

// DELETE /api/admin/courses/:courseId
// Soft delete somente se draft=true, deleted_at IS NULL e SEM entitlements ativos.
// Implementação atômica com UPDATE ... WHERE ... AND NOT EXISTS (...) em transação SERIALIZABLE.
router.delete("/courses/:courseId", async (req, res) => {
  const id = String(req.params.courseId || "").trim();
  if (!isUuid(id)) return res.status(400).json({ error: "invalid_courseId" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const attempt = await client.query(
      `
      with del as (
        update courses c
           set deleted_at = now()
         where c.id = $1
           and c.draft = true
           and c.deleted_at is null
           and not exists (
             select 1
               from entitlements e
              where e.course_id = c.id
                and now() < coalesce(e.ends_at, '9999-12-31'::timestamptz)
           )
         returning c.id, c.slug, c.title, c.deleted_at
      )
      select * from del
      `,
      [id]
    );

    if (attempt.rowCount) {
      await client.query("COMMIT");
      return res.json({ ok: true, deleted: true, course: attempt.rows[0] });
    }

    // Diagnóstico (não compromete a atomicidade da operação anterior)
    const status = await client.query(
      `
      select c.id, c.draft, c.deleted_at,
             exists (
               select 1
                 from entitlements e
                where e.course_id = c.id
                  and now() < coalesce(e.ends_at, '9999-12-31'::timestamptz)
             ) as has_entitlements
        from courses c
       where c.id = $1
       limit 1
      `,
      [id]
    );

    await client.query("ROLLBACK");

    if (!status.rowCount) return res.status(404).json({ error: "not_found" });
    const row = status.rows[0];
    if (!row.draft || row.deleted_at) return res.status(409).json({ error: "not_draft" });
    if (row.has_entitlements) return res.status(409).json({ error: "has_entitlements" });
    return res.status(500).json({ error: "delete_failed" });
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    if (String(e?.code) === "40001") {
      return res.status(409).json({ error: "serialization_failure", retry: true });
    }
    return res.status(500).json({ error: "delete_failed", detail: String(e?.message || e) });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/courses/:courseId/publish
 * Transição draft->publicado (active=true, draft=false)
 */
router.post("/courses/:courseId/publish", async (req, res) => {
  const id = String(req.params.courseId || "").trim();
  if (!isUuid(id)) return res.status(400).json({ error: "invalid_courseId" });
  try {
    const r = await pool.query(
      `update courses
          set draft = false,
              active = true
        where id = $1
          and draft = true
          and deleted_at is null
        returning id, slug, title, draft, active`,
      [id]
    );
    if (!r.rowCount) return res.status(409).json({ error: "cannot_publish" });
    return res.json({ ok: true, course: r.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ error: "publish_failed", detail: String(e?.message || e) });
  }
});

// ===== Módulos =====
router.post("/modules", async (req, res) => {
  const parsed = ModuleBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const m = parsed.data;
  const { rows } = await pool.query(
    `insert into modules(course_id,title,"order") values ($1,$2,$3) returning *`,
    [m.courseId, m.title, m.order]
  );
  res.json(rows[0]);
});

// ==============
// PUT /admin/modules/:id  -> update title/order
// ==============
const updateModuleSchema = z.object({
  title: z.string().min(1).optional(),
  order: z.number().int().min(0).optional(),
});

router.put("/modules/:id", async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: "invalid_id", param: "id" });
  }
  const parse = updateModuleSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  const { title, order } = parse.data;
  if (title === undefined && order === undefined) {
    return res.status(400).json({ error: "no_fields" });
  }
  const fields: string[] = [];
  const values: Array<string | number> = [];
  if (title !== undefined) {
    fields.push(`title = $${fields.length + 1}`);
    values.push(title);
  }
  if (order !== undefined) {
    fields.push(`"order" = $${fields.length + 1}`);
    values.push(order);
  }
  values.push(id);
  const sql = `UPDATE modules SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING id, title, "order", course_id`;
  const r = await pool.query(sql, values);
  if (r.rowCount === 0) return res.status(404).json({ error: "not_found" });
  return res.json({ module: r.rows[0] });
});

// ==============
// PATCH /admin/modules/:id/reorder  -> define nova ordem dos itens
// Body: { itemIds: string[] }  (ordem no array = ordem final 1..n)
// ==============
const reorderSchema = z.object({
  itemIds: z.array(z.string().uuid()).nonempty(), // ids da tabela module_items.id
});

router.patch("/modules/:id/reorder", async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: "invalid_id", param: "id" });
  }
  const parse = reorderSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  const { itemIds } = parse.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const module = await client.query(`SELECT id FROM modules WHERE id = $1`, [id]);
    if (module.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "module_not_found" });
    }

    const current = await client.query<{ id: string }>(
      `SELECT id FROM module_items WHERE module_id = $1`,
      [id]
    );
    const currentIds = current.rows.map(row => row.id);
    const currentSet = new Set(currentIds);

    if (currentIds.length !== itemIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "length_mismatch" });
    }

    if (new Set(itemIds).size !== itemIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "duplicate_item_ids" });
    }

    for (const itemId of itemIds) {
      if (!currentSet.has(itemId)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "item_not_in_module", id: itemId });
      }
    }

    // Passo 1: desloca ordens atuais para evitar colisão com UNIQUE
    await client.query(
      `UPDATE module_items SET "order" = "order" + 1000 WHERE module_id = $1`,
      [id]
    );

    // Passo 2: aplica nova ordem 1..N
    for (let index = 0; index < itemIds.length; index++) {
      await client.query(
        `UPDATE module_items SET "order" = $1 WHERE id = $2`,
        [index + 1, itemIds[index]]
      );
    }

    await client.query("COMMIT");

    const reordered = await client.query(
      `SELECT id, module_id, "order"
         FROM module_items
        WHERE module_id = $1
        ORDER BY "order" ASC, id ASC`,
      [id]
    );

    return res.json({ items: reordered.rows });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("admin.reorder.rollback_failed", rollbackErr);
    }
    console.error("admin.reorder", err);
    return res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

// DELETE /api/admin/modules/:id  -> exclui módulo e dependências (itens, quizzes, questions, progress)
router.delete("/modules/:id", async (req, res) => {
  const moduleId = String(req.params.id || "");
  if (!isUuid(moduleId)) return res.status(400).json({ error: "invalid_module_id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const exists = await client.query(`select id from modules where id = $1`, [moduleId]);
    if (exists.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "module_not_found" });
    }

    // Limpa progresso referente ao módulo (evita órfãos)
    await client.query(`delete from progress where module_id = $1`, [moduleId]);
    // Apaga questões e quizzes do módulo
    await client.query(
      `delete from questions where quiz_id in (select id from quizzes where module_id = $1)`,
      [moduleId]
    );
    await client.query(`delete from quizzes where module_id = $1`, [moduleId]);
    // Apaga itens
    await client.query(`delete from module_items where module_id = $1`, [moduleId]);
    // Apaga módulo
    const del = await client.query(`delete from modules where id = $1 returning id`, [moduleId]);

    await client.query("COMMIT");
    return res.json({ ok: true, moduleId: del.rows[0].id });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback error
    }
    return res.status(500).json({
      error: "server_error",
      detail: String((e as any)?.message || e),
    });
  } finally {
    client.release();
  }
});

// POST /api/admin/modules/:moduleId/duplicate
// Body: { targetCourseId?: uuid, title?: string, order?: number, blankMedia?: boolean }
router.post("/modules/:moduleId/duplicate", async (req, res) => {
  const moduleId = String(req.params.moduleId || "");
  if (!isUuid(moduleId)) return res.status(400).json({ error: "invalid_module_id" });
  const targetCourseId = String(req.body?.targetCourseId || "");
  const titleArg = String(req.body?.title || "");
  const orderArg = req.body?.order;
  const blankMedia = !!req.body?.blankMedia;

  function cleanPayload(ref: any) {
    if (!blankMedia) return ref || {};
    if (!ref || typeof ref !== "object") return {};
    const clone = { ...ref };
    for (const k of ["mux_playback_id", "mux_asset_id", "doc_id", "html", "url"]) {
      if (k in clone) delete (clone as any)[k];
    }
    return clone;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const srcM = await client.query(
      `select id, course_id, title from modules where id = $1`,
      [moduleId]
    );
    if (!srcM.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "module_not_found" });
    }
    const srcModule = srcM.rows[0];
    const dstCourseId = isUuid(targetCourseId) ? targetCourseId : srcModule.course_id;

    const cQ = await client.query(
      `select id from courses where id = $1 and deleted_at is null`,
      [dstCourseId]
    );
    if (!cQ.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "target_course_not_found" });
    }

    const mCountQ = await client.query(
      `select id from modules where course_id = $1 order by "order" asc, id asc`,
      [dstCourseId]
    );
    const count = mCountQ.rowCount;
    let finalOrder: number;
    if (Number.isInteger(orderArg) && orderArg > 0) {
      finalOrder = Math.min(Math.max(Number(orderArg), 1), count + 1);
      await client.query(
        `update modules set "order" = "order" + 1 where course_id = $1 and "order" >= $2`,
        [dstCourseId, finalOrder]
      );
    } else {
      finalOrder = count + 1;
    }

    const newTitle = titleArg ? titleArg : `${srcModule.title} (cópia)`;
    const insM = await client.query(
      `insert into modules(id, course_id, title, "order")
       values (gen_random_uuid(), $1, $2, $3)
       returning id, course_id, title, "order"`,
      [dstCourseId, newTitle, finalOrder]
    );
    const newModuleId = insM.rows[0].id;

    const itQ = await client.query(
      `select id, type, "order", payload_ref from module_items where module_id = $1 order by "order" asc, id asc`,
      [moduleId]
    );

    const quizQ = await client.query(
      `select id, pass_score from quizzes where module_id = $1`,
      [moduleId]
    );
    let newQuizId: string | null = null;
    if (quizQ.rowCount) {
      const srcQuiz = quizQ.rows[0];
      const qIns = await client.query(
        `insert into quizzes(id, module_id, pass_score)
         values (gen_random_uuid(), $1, $2)
         returning id`,
        [newModuleId, srcQuiz.pass_score]
      );
      newQuizId = qIns.rows[0].id;
      const qsQ = await client.query(
        `select kind, body, choices, answer_key from questions where quiz_id = $1`,
        [srcQuiz.id]
      );
      for (const row of qsQ.rows) {
        await client.query(
          `insert into questions(id, quiz_id, kind, body, choices, answer_key)
           values (gen_random_uuid(), $1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
          [
            newQuizId,
            row.kind,
            JSON.stringify(row.body || {}),
            JSON.stringify(row.choices || []),
            JSON.stringify(row.answer_key || null),
          ]
        );
      }
    }

    for (let i = 0; i < itQ.rowCount; i++) {
      const srcIt = itQ.rows[i];
      let payloadRef = cleanPayload(srcIt.payload_ref);
      if (srcIt.type === "quiz") {
        if (newQuizId) payloadRef = { quiz_id: newQuizId };
        else payloadRef = {};
      }
      await client.query(
        `insert into module_items(id, module_id, type, "order", payload_ref)
         values (gen_random_uuid(), $1, $2, $3, $4::jsonb)`,
        [newModuleId, srcIt.type, i + 1, JSON.stringify(payloadRef)]
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true, module: insM.rows[0], quizId: newQuizId });
  } catch (e: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ error: "duplicate_module_failed", detail: String(e?.message || e) });
  } finally {
    client.release();
  }
});

// ===== Itens =====
router.post("/items", async (req, res) => {
  const parsed = ItemBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const it = parsed.data;
  const { rows } = await pool.query(
    `insert into module_items(module_id,type,"order",payload_ref) values ($1,$2,$3,$4) returning *`,
    [it.moduleId, it.type, it.order, it.payloadRef]
  );
  res.json(rows[0]);
});

// POST /api/admin/modules/:moduleId/quiz-wizard
// Body: { passScore?: number, order?: number }
router.post("/modules/:moduleId/quiz-wizard", async (req, res) => {
  const moduleId = String(req.params.moduleId || "");
  if (!isUuid(moduleId)) return res.status(400).json({ error: "invalid_module_id" });
  const passScore = req.body?.passScore == null ? 70 : Number(req.body.passScore);
  const orderArg = req.body?.order;
  if (!Number.isFinite(passScore) || passScore < 0 || passScore > 100) {
    return res.status(400).json({ error: "invalid_pass_score" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mQ = await client.query(`select id from modules where id = $1`, [moduleId]);
    if (!mQ.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "module_not_found" });
    }

    const qRes = await client.query(
      `insert into quizzes(id, module_id, pass_score)
       values (gen_random_uuid(), $1, $2)
       returning id, module_id, pass_score`,
      [moduleId, passScore]
    );
    const quizId = qRes.rows[0].id;

    const itsQ = await client.query(
      `select id, "order" from module_items where module_id = $1 order by "order" asc, id asc`,
      [moduleId]
    );
    const count = itsQ.rowCount;
    let finalOrder: number;
    if (Number.isInteger(orderArg) && orderArg > 0) {
      finalOrder = Math.min(Math.max(Number(orderArg), 1), count + 1);
      await client.query(
        `update module_items set "order" = "order" + 1 where module_id = $1 and "order" >= $2`,
        [moduleId, finalOrder]
      );
    } else {
      finalOrder = count + 1;
    }

    const itemRes = await client.query(
      `insert into module_items(id, module_id, type, "order", payload_ref)
       values (gen_random_uuid(), $1, 'quiz', $2, $3::jsonb)
       returning id, module_id, type, "order", payload_ref`,
      [moduleId, finalOrder, JSON.stringify({ quiz_id: quizId })]
    );

    await client.query("COMMIT");
    return res.json({
      ok: true,
      quiz: qRes.rows[0],
      item: itemRes.rows[0],
    });
  } catch (e: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ error: "quiz_wizard_failed", detail: String(e?.message || e) });
  } finally {
    client.release();
  }
});

// PUT /api/admin/items/:itemId  -> atualiza type/payloadRef do item
router.put("/items/:itemId", async (req, res) => {
  const itemId = String(req.params.itemId || "");
  if (!isUuid(itemId)) return res.status(400).json({ error: "invalid_item_id" });

  const parsed = ItemUpdateBody.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const fields: string[] = [];
  const values: any[] = [];
  if (parsed.data.type !== undefined) {
    fields.push(`type = $${fields.length + 1}`);
    values.push(parsed.data.type);
  }
  if (parsed.data.payloadRef !== undefined) {
    fields.push(`payload_ref = $${fields.length + 1}::jsonb`);
    values.push(JSON.stringify(parsed.data.payloadRef));
  }

  if (fields.length === 0) return res.status(400).json({ error: "no_fields" });

  values.push(itemId);
  const sql = `update module_items set ${fields.join(", ")} where id = $${values.length} returning id, module_id, type, "order", payload_ref`;
  const r = await pool.query(sql, values);
  if (r.rowCount === 0) return res.status(404).json({ error: "not_found" });

  return res.json({ item: r.rows[0] });
});

// DELETE /api/admin/items/:itemId  -> exclui item
router.delete("/items/:itemId", async (req, res) => {
  const itemId = String(req.params.itemId || "");
  if (!isUuid(itemId)) return res.status(400).json({ error: "invalid_item_id" });

  const r = await pool.query(`delete from module_items where id = $1 returning id`, [itemId]);
  if (r.rowCount === 0) return res.status(404).json({ error: "not_found" });

  return res.json({ ok: true, id: r.rows[0].id });
});

// POST /api/admin/items/:itemId/duplicate
// Body: { targetModuleId?: uuid, order?: number, blankMedia?: boolean }
router.post("/items/:itemId/duplicate", async (req, res) => {
  const itemId = String(req.params.itemId || "");
  if (!isUuid(itemId)) return res.status(400).json({ error: "invalid_item_id" });
  const targetModuleId = String(req.body?.targetModuleId || "");
  const orderArg = req.body?.order;
  const blankMedia = !!req.body?.blankMedia;

  function cleanPayload(ref: any) {
    if (!blankMedia) return ref || {};
    if (!ref || typeof ref !== "object") return {};
    const clone = { ...ref };
    for (const k of ["mux_playback_id", "mux_asset_id", "doc_id", "html", "url"]) {
      if (k in clone) delete (clone as any)[k];
    }
    return clone;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const srcQ = await client.query(
      `select id, module_id, type, "order", payload_ref from module_items where id = $1`,
      [itemId]
    );
    if (!srcQ.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "item_not_found" });
    }
    const src = srcQ.rows[0];

    const dstModuleId = isUuid(targetModuleId) ? targetModuleId : src.module_id;
    const dstMQ = await client.query(`select id from modules where id = $1`, [dstModuleId]);
    if (!dstMQ.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "target_module_not_found" });
    }

    const itsQ = await client.query(
      `select id from module_items where module_id = $1 order by "order" asc, id asc`,
      [dstModuleId]
    );
    const count = itsQ.rowCount;
    let finalOrder: number;
    if (Number.isInteger(orderArg) && orderArg > 0) {
      finalOrder = Math.min(Math.max(Number(orderArg), 1), count + 1);
      await client.query(
        `update module_items set "order" = "order" + 1 where module_id = $1 and "order" >= $2`,
        [dstModuleId, finalOrder]
      );
    } else {
      finalOrder = count + 1;
    }

    if (src.type !== "quiz") {
      const payloadRef = cleanPayload(src.payload_ref);
      const ins = await client.query(
        `insert into module_items(id, module_id, type, "order", payload_ref)
         values (gen_random_uuid(), $1, $2, $3, $4::jsonb)
         returning id, module_id, type, "order"`,
        [dstModuleId, src.type, finalOrder, JSON.stringify(payloadRef)]
      );
      await client.query("COMMIT");
      return res.json({ ok: true, item: ins.rows[0] });
    }

    const srcQuizId = src.payload_ref?.quiz_id;
    if (!isUuid(String(srcQuizId))) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "invalid_quiz_item_payload" });
    }

    const qQ = await client.query(
      `select id, module_id, pass_score from quizzes where id = $1`,
      [srcQuizId]
    );
    if (!qQ.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "quiz_not_found" });
    }
    const srcQuiz = qQ.rows[0];

    const newQ = await client.query(
      `insert into quizzes(id, module_id, pass_score)
       values (gen_random_uuid(), $1, $2)
       returning id, module_id, pass_score`,
      [dstModuleId, srcQuiz.pass_score]
    );
    const newQuizId = newQ.rows[0].id;

    const qsQ = await client.query(
      `select kind, body, choices, answer_key from questions where quiz_id = $1`,
      [srcQuizId]
    );
    for (const row of qsQ.rows) {
      await client.query(
        `insert into questions(id, quiz_id, kind, body, choices, answer_key)
         values (gen_random_uuid(), $1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
        [
          newQuizId,
          row.kind,
          JSON.stringify(row.body || {}),
          JSON.stringify(row.choices || []),
          JSON.stringify(row.answer_key || null),
        ]
      );
    }

    const ins = await client.query(
      `insert into module_items(id, module_id, type, "order", payload_ref)
       values (gen_random_uuid(), $1, 'quiz', $2, $3::jsonb)
       returning id, module_id, type, "order"`,
      [dstModuleId, finalOrder, JSON.stringify({ quiz_id: newQuizId })]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, item: ins.rows[0], quizId: newQuizId });
  } catch (e: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ error: "duplicate_item_failed", detail: String(e?.message || e) });
  } finally {
    client.release();
  }
});

// ===== Quizzes =====
router.post("/quizzes", async (req, res: Response) => {
  const parsed = QuizBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const q = parsed.data;
  const { rows } = await pool.query(
    `insert into quizzes(module_id, pass_score) values ($1,$2)
     on conflict (module_id) do update set pass_score = excluded.pass_score
     returning *`,
    [q.moduleId, q.passScore]
  );
  res.json(rows[0]);
});

router.post("/questions", async (req, res) => {
  const parsed = QuestionBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const q = parsed.data;
  const { rows } = await pool.query(
    `insert into questions(quiz_id,kind,body,choices,answer_key) values ($1,$2,$3,$4,$5) returning *`,
    [q.quizId, q.kind, q.body, q.choices, q.answerKey as any]
  );
  res.json(rows[0]);
});

// ---------------------------------------------------------
// QUIZZES (ADMIN)
// ---------------------------------------------------------
// POST /api/admin/modules/:moduleId/quiz  → cria/atualiza quiz do módulo
router.post("/modules/:moduleId/quiz", async (req, res) => {
  try {
    const moduleId = String(req.params.moduleId);
    const passScoreRaw = req.body?.passScore;
    const passScore = Number.isFinite(passScoreRaw) ? Number(passScoreRaw) : 70;
    if (passScore < 0 || passScore > 100) {
      return res.status(400).json({ error: "invalid_pass_score" });
    }

    // garante que o módulo existe
    const m = await pool.query(
      `select id from modules where id = $1 limit 1`,
      [moduleId]
    );
    if (m.rowCount === 0) {
      return res.status(404).json({ error: "module_not_found" });
    }

    // Upsert por module_id
    let q;
    try {
      q = await pool.query(
        `
        insert into quizzes (module_id, pass_score)
        values ($1, $2)
        on conflict (module_id)
        do update set pass_score = excluded.pass_score
        returning id, module_id, pass_score
        `,
        [moduleId, passScore]
      );
    } catch {
      // fallback caso não exista UNIQUE(module_id)
      const cur = await pool.query(
        `select id from quizzes where module_id = $1 limit 1`,
        [moduleId]
      );
      if (cur.rowCount === 0) {
        q = await pool.query(
          `insert into quizzes (module_id, pass_score) values ($1,$2)
           returning id, module_id, pass_score`,
          [moduleId, passScore]
        );
      } else {
        q = await pool.query(
          `update quizzes set pass_score = $2 where id = $1
           returning id, module_id, pass_score`,
          [cur.rows[0].id, passScore]
        );
      }
    }
    return res.json({ quiz: q.rows[0] });
  } catch (err) {
    console.error("admin.createQuiz", err);
    const detail = process.env.DEV_FAKE ? String((err as any)?.message || err) : undefined;
    return res.status(500).json({ error: "server_error", detail });
  }
});

// POST /api/admin/quizzes/:quizId/questions  → adiciona questão
router.post("/quizzes/:quizId/questions", async (req, res) => {
  try {
    const quizId = String(req.params.quizId);
    const kind = String(req.body?.kind || "single");
    const body = req.body?.body ?? {};
    const choices = req.body?.choices ?? [];
    const answerKey = req.body?.answerKey ?? null;

    // valida quiz
    const q = await pool.query(
      `select id from quizzes where id = $1 limit 1`,
      [quizId]
    );
    if (q.rowCount === 0) {
      return res.status(404).json({ error: "quiz_not_found" });
    }

    // insere pergunta (tabela 'questions' com colunas jsonb)
    const ins = await pool.query(
      `
      insert into questions (quiz_id, kind, body, choices, answer_key)
      values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
      returning id, quiz_id, kind, body, choices, answer_key
      `,
      [quizId, kind, JSON.stringify(body), JSON.stringify(choices), JSON.stringify(answerKey)]
    );
    return res.json({ question: ins.rows[0] });
  } catch (err) {
    console.error("admin.addQuestion", err);
    const detail = process.env.DEV_FAKE ? String((err as any)?.message || err) : undefined;
    return res.status(500).json({ error: "server_error", detail });
  }
});

// GET /api/admin/quizzes/:quizId/questions → lista questões
router.get("/quizzes/:quizId/questions", async (req, res) => {
  const quizId = String(req.params.quizId || "");
  if (!isUuid(quizId)) return res.status(400).json({ error: "invalid_quizId" });
  const q = await pool.query(
    `select id, quiz_id, kind, body, choices, answer_key from questions where quiz_id = $1 order by id`,
    [quizId]
  );
  return res.json({ questions: q.rows });
});

// PUT /api/admin/questions/:id → atualizar questão
const QuestionUpdateBody = z.object({
  kind: z.enum(["single", "multiple", "truefalse"]).optional(),
  body: z.record(z.any()).optional(),
  choices: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
  answerKey: z.union([z.array(z.string()), z.boolean()]).optional(),
});

router.put("/questions/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isUuid(id)) return res.status(400).json({ error: "invalid_question_id" });

  const parsed = QuestionUpdateBody.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const fields: string[] = [];
  const values: any[] = [];
  const v = parsed.data;

  if (v.kind !== undefined) {
    fields.push(`kind = $${fields.length + 1}`);
    values.push(v.kind);
  }
  if (v.body !== undefined) {
    fields.push(`body = $${fields.length + 1}::jsonb`);
    values.push(JSON.stringify(v.body));
  }
  if (v.choices !== undefined) {
    fields.push(`choices = $${fields.length + 1}::jsonb`);
    values.push(JSON.stringify(v.choices));
  }
  if (v.answerKey !== undefined) {
    fields.push(`answer_key = $${fields.length + 1}::jsonb`);
    values.push(JSON.stringify(v.answerKey));
  }

  if (fields.length === 0) return res.status(400).json({ error: "no_fields" });

  values.push(id);
  const sql = `update questions set ${fields.join(", ")} where id = $${values.length} returning id, quiz_id, kind, body, choices, answer_key`;
  const r = await pool.query(sql, values);
  if (r.rowCount === 0) return res.status(404).json({ error: "not_found" });
  return res.json({ question: r.rows[0] });
});

// DELETE /api/admin/questions/:id → remover questão
router.delete("/questions/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isUuid(id)) return res.status(400).json({ error: "invalid_question_id" });
  const r = await pool.query(`delete from questions where id = $1 returning id`, [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: "not_found" });
  return res.json({ ok: true, id });
});

// ===== Trilhas =====
router.post("/tracks", async (req, res) => {
  const parsed = TrackBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const t = parsed.data;
  const { rows } = await pool.query(
    `insert into tracks(slug,title,active)
     values ($1,$2,$3)
     on conflict (slug) do update set title=excluded.title, active=excluded.active
     returning *`,
    [t.slug, t.title, t.active]
  );
  res.json(rows[0]);
});

router.post("/track-courses", async (req, res) => {
  const parsed = TrackCourseBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const tc = parsed.data;
  const { rows } = await pool.query(
    `insert into track_courses(track_id, course_id, "order", required)
     values ($1,$2,$3,$4)
     on conflict (track_id, course_id)
     do update set "order"=excluded."order", required=excluded.required
     returning *`,
    [tc.trackId, tc.courseId, tc.order, tc.required]
  );
  res.json(rows[0]);
});

// ===== Pré-requisitos (curso -> curso) =====
router.post("/prerequisites", async (req, res) => {
  const parsed = PrereqBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const p = parsed.data;
  if (p.courseId === p.requiredCourseId) {
    return res.status(400).json({ error: "course_cannot_require_itself" });
  }
  const { rows } = await pool.query(
    `insert into prerequisites(course_id, required_course_id)
     values ($1,$2)
     on conflict do nothing
     returning course_id, required_course_id`,
    [p.courseId, p.requiredCourseId]
  );
  res.json(rows[0] || { ok: true });
});

// ===== Visualizador: grafo de trilha + prereqs + status do aluno =====
/**
 * GET /admin/track-graph?trackId=...&email=... (ou &userId=...)
 * Retorna:
 * {
 *   track: { id, title },
 *   nodes: [{ id, title, slug, order, level, moduleCount, progressPct, courseCompleted, hasEntitlement, prereqsMet }],
 *   edges: [{ from, to }],
 *   hasCycle: boolean
 * }
 */
router.get("/track-graph", async (req: Request, res: Response) => {
  const trackId = String(req.query.trackId || "");
  const email = (req.query.email as string) || "";
  const userIdParam = (req.query.userId as string) || "";
  if (!trackId) return res.status(400).json({ error: "trackId required" });

  const client = await pool.connect();
  try {
    // resolve usuário (opcional)
    let userId: string | null = null;
    if (userIdParam) {
      userId = userIdParam;
    } else if (email) {
      const u = await client.query(`select id from users where lower(email)=lower($1)`, [email]);
      userId = u.rows[0]?.id || null;
    }

    const t = await client.query(`select id, title from tracks where id = $1`, [trackId]);
    if (t.rowCount === 0) return res.status(404).json({ error: "track_not_found" });
    const track = t.rows[0];

    const tc = await client.query(
      `select tc.course_id, c.title, c.slug, tc."order"
       from track_courses tc
       join courses c on c.id = tc.course_id
       where tc.track_id = $1
       order by tc."order" asc`,
      [trackId]
    );
    const courseIds = tc.rows.map((r) => r.course_id);
    if (courseIds.length === 0) {
      return res.json({ track, nodes: [], edges: [], hasCycle: false });
    }

    const prereq = await client.query(
      `select course_id, required_course_id
       from prerequisites
       where course_id = any($1::uuid[])`,
      [courseIds]
    );

    const moduleCounts = await client.query(
      `select course_id, count(*)::int as cnt
       from modules
       where course_id = any($1::uuid[])
       group by course_id`,
      [courseIds]
    );

    const passedCounts = userId
      ? await client.query(
          `select m.course_id, count(*)::int as cnt
           from modules m
           join progress p on p.module_id = m.id
           where p.user_id = $1 and p.status in ('passed','completed')
                 and m.course_id = any($2::uuid[])
           group by m.course_id`,
          [userId, courseIds]
        )
      : { rows: [] as any[] };

    const ent = userId
      ? await client.query(
          `select course_id from entitlements where user_id = $1 and course_id = any($2::uuid[])`,
          [userId, courseIds]
        )
      : { rows: [] as any[] };

    const modMap = new Map<string, number>(
      moduleCounts.rows.map((r: any) => [r.course_id, Number(r.cnt)])
    );
    const passMap = new Map<string, number>(
      passedCounts.rows.map((r: any) => [r.course_id, Number(r.cnt)])
    );
    const entSet = new Set<string>(ent.rows.map((r: any) => r.course_id));

    // cursos concluídos = 100% módulos (se houver módulos)
    const completedSet = new Set<string>();
    for (const id of courseIds) {
      const total = modMap.get(id) || 0;
      const passed = passMap.get(id) || 0;
      if (total > 0 && passed >= total) completedSet.add(id);
    }

    // grafo: nós e arestas internas à trilha
    const edges = prereq.rows
      .filter((r: any) => courseIds.includes(r.required_course_id))
      .map((r: any) => ({ from: r.required_course_id, to: r.course_id }));

    // layering simples (Kahn) considerando apenas prereqs internos
    const indeg = new Map<string, number>();
    for (const id of courseIds) indeg.set(id, 0);
    for (const e of edges) indeg.set(e.to, (indeg.get(e.to) || 0) + 1);

    const levels = new Map<string, number>();
    const q: string[] = [];
    indeg.forEach((deg, id) => { if (deg === 0) q.push(id); });

    let hasCycle = false;
    while (q.length) {
      const cur = q.shift()!;
      const curLevel = levels.get(cur) ?? 0;
      for (const e of edges.filter((x) => x.from === cur)) {
        const d = (indeg.get(e.to) || 0) - 1;
        indeg.set(e.to, d);
        if (d === 0) {
          levels.set(e.to, Math.max(levels.get(e.to) ?? 0, curLevel + 1));
          q.push(e.to);
        }
      }
      if (!levels.has(cur)) levels.set(cur, 0);
    }
    // verifica ciclo: se alguém ficou com indegree > 0
    for (const [id, deg] of indeg.entries()) if (deg > 0) hasCycle = true;

    // monta nós com métricas
    const prereqMap = new Map<string, string[]>();
    for (const r of prereq.rows) {
      const arr = prereqMap.get(r.course_id) || [];
      arr.push(r.required_course_id);
      prereqMap.set(r.course_id, arr);
    }

    const nodes = tc.rows.map((r: any) => {
      const total = modMap.get(r.course_id) || 0;
      const passed = passMap.get(r.course_id) || 0;
      const progressPct = total > 0 ? Math.round((passed / total) * 100) : 0;
      const courseCompleted = completedSet.has(r.course_id);
      const hasEntitlement = entSet.has(r.course_id);
      const reqs = prereqMap.get(r.course_id) || [];
      const prereqsMet = reqs.every((reqId) => completedSet.has(reqId));
      return {
        id: r.course_id,
        title: r.title,
        slug: r.slug,
        order: Number(r.order),
        level: levels.get(r.course_id) ?? 0,
        moduleCount: total,
        progressPct,
        courseCompleted,
        hasEntitlement,
        prereqsMet,
        prereqIds: reqs,
      };
    });

    res.json({ track, nodes, edges, hasCycle });
  } finally {
    client.release();
  }
});

export default router;

// ========= Guards com :id — manter DEPOIS de rotas literais (/courses/import, /courses/_*) =========
// Observação importante:
// - router.use("/courses/:id", ...) faz match por prefixo; se for registrado antes,
//   ele também intercepta /courses/import e retorna 400 (invalid_id) para "import".
// - Portanto, mantenha estes guards SEMPRE após todas as rotas literais /courses/xxx.
router.use("/courses/:id", paramUuid("id"));
router.use("/tracks/:id",  paramUuid("id"));
router.use("/users/:id",   paramUuid("id"));

// ====== ADDITIONS (append-only) ======
// Observação: estas rotas podem ser adicionadas ao final do arquivo, mesmo após `export default router`.
// O objeto `router` é o mesmo em memória e continuará recebendo handlers.

// PATCH /api/admin/courses/:courseId/modules/reorder
// Body: { moduleIds: uuid[] } — reordena os módulos do curso para 1..N na ordem fornecida
router.patch("/courses/:courseId/modules/reorder", async (req, res) => {
  const courseId = String(req.params.courseId || "");
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_courseId" });
  const moduleIds = Array.isArray(req.body?.moduleIds) ? req.body.moduleIds : [];
  if (!moduleIds.length) return res.status(400).json({ error: "moduleIds_required" });

  // validar todos UUIDs
  for (const id of moduleIds)
    if (!isUuid(String(id))) {
      return res.status(400).json({ error: "invalid_module_id_in_list", id });
    }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // checar se todos pertencem ao courseId
    const q = await client.query(
      `select id from modules where course_id = $1 and id = any($2::uuid[])`,
      [courseId, moduleIds]
    );
    if (q.rowCount !== moduleIds.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "modules_not_in_course" });
    }

    // aplica ordem 1..N
    for (let i = 0; i < moduleIds.length; i++) {
      await client.query(`update modules set "order" = $1 where id = $2`, [i + 1, moduleIds[i]]);
    }
    await client.query("COMMIT");

    const out = await pool.query(
      `select id, title, "order" from modules where course_id = $1 order by "order", id`,
      [courseId]
    );
    return res.json({ ok: true, modules: out.rows });
  } catch (e: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res
      .status(500)
      .json({ error: "reorder_modules_failed", detail: String(e?.message || e) });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/quizzes/:quizId  → atualizar passScore
router.patch("/quizzes/:quizId", async (req, res) => {
  const quizId = String(req.params.quizId || "");
  if (!isUuid(quizId)) return res.status(400).json({ error: "invalid_quizId" });
  const passScoreRaw = req.body?.passScore;
  const passScore = Number(passScoreRaw);
  if (!Number.isFinite(passScore) || passScore < 0 || passScore > 100) {
    return res.status(400).json({ error: "invalid_passScore" });
  }
  const r = await pool.query(
    `update quizzes set pass_score = $1 where id = $2 returning id, module_id, pass_score`,
    [passScore, quizId]
  );
  if (!r.rowCount) return res.status(404).json({ error: "quiz_not_found" });
  return res.json({ quiz: r.rows[0] });
});
