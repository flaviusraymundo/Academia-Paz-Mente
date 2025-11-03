// src/server/routes/admin.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { z } from "zod";

const router = Router();

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
router.post("/quizzes", async (req, res) => {
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

export default router;
