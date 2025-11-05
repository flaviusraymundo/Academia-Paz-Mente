// src/server/routes/catalog.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { isUuid } from "../utils/ids.js";

const router = Router();

/**
 * GET /catalog
 * Lista cursos e trilhas ativas com contagem de módulos e itens.
 */
router.get("/", async (_req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { rows: courses } = await client.query(
      `
      select
        c.id, c.slug, c.title, c.summary, c.level, c.active,
        coalesce(m.cnt,0)::int as module_count,
        coalesce(i.cnt,0)::int as item_count
      from courses c
      left join (
        select course_id, count(*) cnt from modules group by course_id
      ) m on m.course_id = c.id
      left join (
        select mo.course_id, count(*) cnt
        from modules mo
        join module_items mi on mi.module_id = mo.id
        group by mo.course_id
      ) i on i.course_id = c.id
      where c.active = true
      order by c.title asc
      `
    );

    const { rows: tracks } = await client.query(
      `
      select
        t.id, t.slug, t.title, t.active,
        json_agg(json_build_object(
          'courseId', tc.course_id,
          'order', tc."order",
          'required', tc.required
        ) order by tc."order" asc) as courses
      from tracks t
      join track_courses tc on tc.track_id = t.id
      where t.active = true
      group by t.id
      order by t.title asc
      `
    );

    res.json({ courses, tracks });
  } finally {
    client.release();
  }
});

/**
 * GET /courses/:courseId/modules
 * Retorna módulos e itens ordenados e marca 'unlocked' com base no progresso.
 */
router.get("/courses/:courseId/modules", async (req: Request, res: Response) => {
  const { courseId } = req.params;
  if (!isUuid(courseId)) {
    return res.status(400).json({ error: "invalid_id", param: "courseId" });
  }
  const userId = req.auth?.userId || null; // opcional para catálogo público
  const client = await pool.connect();
  try {
    const { rows: modules } = await client.query(
      `
      select
        m.id as module_id, m.title, m."order",
        coalesce(p.status, 'started') as status,
        coalesce(p.score, 0) as score,
        coalesce(p.time_spent_secs, 0) as time_spent_secs
      from modules m
      left join progress p
        on p.module_id = m.id and p.user_id = $2
      where m.course_id = $1
      order by m."order" asc
      `,
      [courseId, userId]
    );

    const { rows: items } = await client.query(
      `
      select mi.id as item_id, mi.module_id, mi.type, mi."order", mi.payload_ref
      from module_items mi
      join modules m on m.id = mi.module_id
      where m.course_id = $1
      order by mi.module_id asc, mi."order" asc
      `,
      [courseId]
    );

    // regra simples: módulo 1 liberado; seguintes liberados se anterior status 'passed' ou 'completed'
    const sorted = modules.sort((a, b) => a.order - b.order);
    let unlocked = true;
    const out = sorted.map((m, idx) => {
      const isUnlocked = unlocked || idx === 0;
      if (!(m.status === "passed" || m.status === "completed")) {
        unlocked = false;
      }
      const its = items.filter((it) => it.module_id === m.module_id);
      return {
        id: m.module_id,
        title: m.title,
        order: m.order,
        unlocked: isUnlocked,
        itemCount: its.length,
        items: its,
        progress: {
          status: m.status,
          score: Number(m.score),
          timeSpentSecs: Number(m.time_spent_secs),
        },
      };
    });

    res.json({ items: out });
  } finally {
    client.release();
  }
});

export default router;
