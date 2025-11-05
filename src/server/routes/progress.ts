// src/server/routes/progress.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { z } from "zod";
import { ulid } from "ulid";
import { requireAuth } from "../middleware/auth.js";
import { validateQuery, qCourseId } from "../utils/validate.js";

const router = Router();

type ModuleRow = {
  module_id: string;
  title: string;
  order: number;
  status: string | null;
  score: number | null;
  time_spent_secs: number | null;
};

type ItemRow = {
  item_id: string;
  module_id: string;
  type: string;
  order: number;
  payload_ref: any;
};

type ModuleProgressRow = {
  module_id: string;
  status: string | null;
  score: number | null;
  time_spent_secs: number | null;
};

type ModuleStatusRow = {
  module_id: string;
  status: string | null;
};

type CourseIdQuery = z.infer<typeof qCourseId>;

async function meItemsHandler(req: Request, res: Response) {
  const userId = req.auth?.userId ?? req.user?.id ?? null;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const { courseId } = req.query as CourseIdQuery;

  try {
    const { rows: modules } = await pool.query<ModuleRow>(
      `
      select
        m.id as module_id,
        m.title,
        m."order",
        p.status,
        p.score,
        p.time_spent_secs
      from modules m
      left join progress p on p.module_id = m.id and p.user_id = $1
      where m.course_id = $2
      order by m."order" asc, m.id asc
      `,
      [userId, courseId]
    );

    if (modules.length === 0) {
      return res.json({ items: [] });
    }

    const moduleIds = modules.map((m) => m.module_id);
    const { rows: rawItems } = await pool.query<ItemRow>(
      `
      select mi.id as item_id, mi.module_id, mi.type, mi."order", mi.payload_ref
      from module_items mi
      where mi.module_id = any($1::uuid[])
      order by mi.module_id asc, mi."order" asc
      `,
      [moduleIds]
    );

    const itemsByModule = new Map<string, ItemRow[]>();
    for (const item of rawItems) {
      const bucket = itemsByModule.get(item.module_id) ?? [];
      bucket.push(item);
      itemsByModule.set(item.module_id, bucket);
    }

    const items = modules
      .map((mod) => ({
        id: mod.module_id,
        title: mod.title,
        order: Number(mod.order),
        unlocked: false,
        itemCount: 0,
        items: (itemsByModule.get(mod.module_id) ?? []).map((it) => ({
          item_id: it.item_id,
          module_id: it.module_id,
          type: it.type,
          order: Number(it.order),
          payload_ref: it.payload_ref,
        })),
        progress: {
          status: mod.status ?? "not_started",
          score: Number(mod.score ?? 0),
          timeSpentSecs: Number(mod.time_spent_secs ?? 0),
        },
      }))
      .sort((a, b) => a.order - b.order);

    if (items.length > 0) {
      items[0].unlocked = true;
      for (let i = 1; i < items.length; i += 1) {
        const prev = items[i - 1];
        items[i].unlocked = prev.progress.status === "passed";
      }
    }

    for (const item of items) {
      item.itemCount = item.items.length;
    }

    return res.json({ items });
  } catch (err) {
    console.error("progress.meItems", err);
    return res.status(500).json({ error: "items_fetch_failed" });
  }
}

router.get("/me/items", requireAuth, validateQuery(qCourseId), meItemsHandler);

// alias opcional (mesmo payload do /me/items)
router.get("/me/modules", requireAuth, validateQuery(qCourseId), meItemsHandler);

router.get("/me/progress", async (req: Request, res: Response) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const { rows } = await pool.query(
    `
    select module_id, status, score, time_spent_secs, updated_at
    from progress
    where user_id = $1
    order by updated_at desc
    `,
    [userId]
  );
  res.json({
    modules: rows.map((r) => ({
      moduleId: r.module_id,
      status: r.status,
      score: r.score ? Number(r.score) : null,
      timeSpentSecs: Number(r.time_spent_secs || 0),
      updatedAt: r.updated_at,
    })),
  });
});

const Patch = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(["started", "paused", "seeked", "completed", "heartbeat"]),
        itemId: z.string().uuid(),
        dt: z.string().datetime().optional(),
        deltaSecs: z.number().int().optional().default(0),
      })
    )
    .min(1),
});

router.patch("/me/progress", async (req: Request, res: Response) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  const parsed = Patch.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const client = await pool.connect();
  try {
    await client.query("begin");

    // mapeia item -> módulo
    const itemIds = [...new Set(parsed.data.events.map((e) => e.itemId))];
    const { rows: maps } = await client.query(
      `select id as item_id, module_id from module_items where id = any($1::uuid[])`,
      [itemIds]
    );
    const toModule = new Map<string, string>(maps.map((m) => [m.item_id, m.module_id]));

    let totalDelta = 0;
    for (const e of parsed.data.events) {
      const moduleId = toModule.get(e.itemId);
      if (!moduleId) continue;

      const dt = e.dt ? new Date(e.dt) : new Date();
      const delta = Math.max(e.deltaSecs || 0, 0);
      totalDelta += delta;

      const eventId = ulid();
      await client.query(
        `insert into event_log(event_id, topic, actor_user_id, entity_type, entity_id, occurred_at, source, payload)
         values ($1,$2,$3,'module',$4,$5,'app',$6)`,
        [
          eventId,
          `progress.${e.type}`,
          userId,
          moduleId,
          dt,
          { itemId: e.itemId, deltaSecs: delta },
        ]
      );

      await client.query(
        `
        insert into progress(user_id, module_id, status, score, time_spent_secs, updated_at)
        values ($1,$2,$3,null,$4, now())
        on conflict (user_id, module_id)
        do update set
          time_spent_secs = progress.time_spent_secs + excluded.time_spent_secs,
          status = case
            when excluded.status='completed' then 'completed'
            when progress.status in ('passed','completed') then progress.status
            else excluded.status
          end,
          updated_at = now()
        `,
        [userId, moduleId, e.type === "completed" ? "completed" : "started", delta]
      );
    }

    await client.query("commit");
    return res.status(204).send();
  } catch (err) {
    await client.query("rollback");
    return res.status(500).json({ error: "progress_update_failed" });
  } finally {
    client.release();
  }
});

router.get("/me/entitlements", async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId ?? (req as any)?.user?.id ?? null;
    if (!userId) return res.status(401).json({ error: "no_user" });

    const q = `
      SELECT id, user_id, course_id, track_id, source, starts_at, ends_at, created_at
        FROM entitlements
       WHERE user_id = $1
         AND now() >= starts_at
         AND now() < COALESCE(ends_at, '9999-12-31'::timestamptz)
       ORDER BY created_at DESC
    `;
    const r = await pool.query(q, [userId]);
    return res.json({ entitlements: r.rows });
  } catch (e) {
    console.error("GET /me/entitlements error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

router.get("/me/modules-summary", requireAuth, validateQuery(qCourseId), async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId ?? (req as any)?.user?.id ?? null;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const { courseId } = req.query as CourseIdQuery;

    const { rows: modules } = await pool.query<{
      id: string;
      title: string;
      order: number;
    }>(
      `select id, title, "order" from modules where course_id = $1 order by "order", id`,
      [courseId]
    );

    if (modules.length === 0) {
      return res.json({ items: [] });
    }

    const moduleIds = modules.map((m) => m.id);
    const { rows: progressRows } = await pool.query<ModuleProgressRow>(
      `
        select module_id, status, score, time_spent_secs
          from progress
         where user_id = $1 and module_id = any($2::uuid[])
      `,
      [userId, moduleIds]
    );
    const progressById = new Map<string, ModuleProgressRow>();
    progressRows.forEach((row) => {
      progressById.set(row.module_id, row);
    });

    const unlockedById = new Map<string, boolean>();
    modules.forEach((mod, index) => {
      if (index === 0) {
        unlockedById.set(mod.id, true);
      } else {
        const prev = modules[index - 1];
        const prevProgress = progressById.get(prev.id);
        unlockedById.set(mod.id, prevProgress?.status === "passed");
      }
    });

    const items = modules.map((mod) => {
      const p = progressById.get(mod.id);
      return {
        id: mod.id,
        title: mod.title,
        order: Number(mod.order),
        unlocked: Boolean(unlockedById.get(mod.id)),
        progress: {
          status: p?.status ?? "not_started",
          score: Number(p?.score ?? 0),
          timeSpentSecs: Number(p?.time_spent_secs ?? 0),
        },
      };
    });

    return res.json({ items });
  } catch (err) {
    console.error("me/modules-summary error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

router.get("/me/progress-summary", requireAuth, validateQuery(qCourseId), async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId ?? (req as any)?.user?.id ?? null;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const { courseId } = req.query as CourseIdQuery;

    const { rows: modules } = await pool.query<{ id: string }>(
      `select id from modules where course_id = $1 order by "order", id`,
      [courseId]
    );

    const moduleIds = modules.map((m) => m.id);
    if (moduleIds.length === 0) {
      return res.json({ totals: { total: 0, passed: 0, started: 0, not_started: 0 }, percent: 0 });
    }

    const { rows } = await pool.query<ModuleStatusRow>(
      `select module_id, status from progress where user_id = $1 and module_id = any($2::uuid[])`,
      [userId, moduleIds]
    );
    const statusByModule = new Map<string, string | null>();
    rows.forEach((row) => {
      statusByModule.set(row.module_id, row.status);
    });

    const totals = { total: moduleIds.length, passed: 0, started: 0, not_started: 0 };
    modules.forEach((mod) => {
      const status = statusByModule.get(mod.id) ?? "not_started";
      if (status === "passed") totals.passed += 1;
      else if (["started", "failed", "completed"].includes(status)) totals.started += 1;
      else totals.not_started += 1;
    });

    const percent = totals.total ? Math.round((totals.passed / totals.total) * 100) : 0;
    return res.json({ totals, percent });
  } catch (err) {
    console.error("me/progress-summary error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
