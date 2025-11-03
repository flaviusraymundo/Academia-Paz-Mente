// src/server/routes/progress.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { z } from "zod";
import { ulid } from "ulid";

const router = Router();

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

export default router;
