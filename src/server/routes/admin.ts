// src/server/routes/admin.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { z } from "zod";
import { isUuid, paramUuid } from "../utils/ids.js";

const router = Router();

// --- Guards de UUID para todos os paths com :id neste router ---
// Cursos
// valida UUID em /courses/:id, mas NÃO casa /courses/_summary
// usa regex no path para aceitar apenas UUID v1–v5
router.use(
  "/courses/:id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
  paramUuid("id")
);
// Módulos
router.use("/modules/:id", paramUuid("id"));
router.use("/modules/:moduleId/quiz", paramUuid("moduleId"));
router.use("/modules/:id/reorder", paramUuid("id"));
// Itens
router.use("/items/:id", paramUuid("id"));
// Quizzes
router.use("/quizzes/:quizId", paramUuid("quizId"));
// Trilhas (se existirem aqui)
router.use("/tracks/:id", paramUuid("id"));
router.use("/track-courses/:id", paramUuid("id"));
// Pré-requisitos
router.use("/prerequisites/:id", paramUuid("id"));
// Entitlements (se houver)
router.use("/entitlements/:id", paramUuid("id"));
// --------------------------------------------------------------

// === Courses: summary (counts) - imune à colisão com :id ===
router.get("/courses/_summary", async (_req: Request, res: Response) => {
  const q = await pool.query(`
    SELECT c.id, c.slug, c.title, c.summary, c.level, c.active,
           COUNT(DISTINCT m.id) AS module_count,
           COUNT(mi.id)        AS item_count
      FROM courses c
      LEFT JOIN modules m ON m.course_id = c.id
      LEFT JOIN module_items mi ON mi.module_id = m.id
     GROUP BY c.id
     ORDER BY c.title ASC
  `);
  res.json({ courses: q.rows });
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
    SELECT id, module_id, type, "order"
      FROM module_items
     WHERE module_id = $1
     ORDER BY "order" ASC, id ASC
    `,
    [moduleId]
  );
  return res.json({ items: items.rows });
});

// ===== Schemas =====
const CourseBody = z.object({
  slug: z.string().min(3),
  title: z.string().min(3),
  summary: z.string().optional().default(""),
  level: z.string().optional().default("beginner"),
  active: z.boolean().optional().default(true),
});

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
