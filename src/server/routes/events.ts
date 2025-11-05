// src/server/routes/events.ts
import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { ulid } from "ulid";

const router = Router();

// Permite eventos sem login somente se TRACK_PUBLIC=1
const ALLOW_PUBLIC = process.env.TRACK_PUBLIC === "1";

const EventItem = z.object({
  type: z.string().min(2),             // ex: "page.view", "ui.click", "checkout.start"
  dt: z.string().datetime().optional(),// ISO; se não vier, usa now()
  path: z.string().optional(),         // location.pathname + search
  referrer: z.string().optional(),     // document.referrer
  sessionId: z.string().optional(),    // opcional (ex: heurística do front)
  anonId: z.string().optional(),       // opcional (localStorage)
  payload: z.record(z.any()).optional().default({}), // quaisquer campos adicionais
});

const Body = z.object({
  events: z.array(EventItem).min(1).max(100),
});

// aceita string vazia => undefined (evita "Invalid uuid" quando input vem vazio)
const uuidOpt = z.preprocess((v) => {
  if (typeof v === "string" && v.trim() === "") return undefined;
  return v;
}, z.string().uuid().optional());

// corpo flexível: aceita courseId/moduleId/itemId opcionais e ms >= 0
const PageReadBody = z.object({
  courseId: uuidOpt,
  moduleId: uuidOpt,
  itemId: uuidOpt,
  ms: z.number().int().min(0),
});

router.post("/", async (req: Request, res: Response) => {
  const authed = Boolean(req.auth?.userId);
  if (!authed && !ALLOW_PUBLIC) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const userId = req.auth?.userId || null;
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
  const ua = (req.headers["user-agent"] as string) || null;

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const e of parsed.data.events) {
      const occurred = e.dt ? new Date(e.dt) : new Date();
      const eventId = ulid();
      const payload = {
        ...e.payload,
        path: e.path,
        referrer: e.referrer,
        sessionId: e.sessionId,
        anonId: e.anonId,
      };
      await client.query(
        `insert into event_log(event_id, topic, actor_user_id, entity_type, entity_id, occurred_at, received_at, source, ip, ua, payload)
         values ($1,$2,$3,null,null,$4, now(), 'app', $5, $6, $7)`,
        [eventId, e.type, userId, occurred, ip, ua, payload]
      );
    }
    await client.query("commit");
    return res.status(204).send();
  } catch (err) {
    await client.query("rollback");
    return res.status(500).json({ error: "event_write_failed" });
  } finally {
    client.release();
  }
});

// POST /events/page-read   (montado também como /api/events/page-read)
router.post("/page-read", async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId || null;
    if (!ALLOW_PUBLIC && !userId) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const parsed = PageReadBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { courseId, moduleId, itemId, ms } = parsed.data;
    const ua = (req.headers["user-agent"] as string) || null;
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
    const payload = {
      courseId: courseId ?? null,
      moduleId: moduleId ?? null,
      itemId: itemId ?? null,
      ms,
      ua,
      ts: new Date().toISOString(),
    };

    await pool.query(
      `insert into event_log(event_id, topic, actor_user_id, occurred_at, received_at, source, ip, ua, payload)
       values ($1,$2,$3, now(), now(), 'app', $4, $5, $6)`,
      [ulid(), "page_read", userId, ip, ua, payload]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("page-read error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
