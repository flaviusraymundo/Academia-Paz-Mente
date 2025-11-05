// src/server/routes/video.ts
import { Router, Request, Response } from "express";
import { z } from "zod";
import jwt, { JwtHeader } from "jsonwebtoken";
import { pool } from "../lib/db.js";
import { ulid } from "ulid";

const router = Router();

// POST /video/heartbeat  (montado também como /api/video/heartbeat)
// registra batimentos de vídeo em event_log (depois podemos consolidar em video_sessions)
const BeatBody = z.object({
  courseId: z.string().uuid().optional(),
  moduleId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  secs: z.number().int().min(1).max(3600), // 1s a 60min
});

router.post("/heartbeat", async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId || null; // /video já exige auth via app.ts
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const parsed = BeatBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { courseId, moduleId, itemId, secs } = parsed.data;
    const ua = (req.headers["user-agent"] as string) || null;
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
    const payload = {
      courseId: courseId ?? null,
      moduleId: moduleId ?? null,
      itemId: itemId ?? null,
      secs,
      ua,
      ts: new Date().toISOString(),
    };

    await pool.query(
      `insert into event_log(event_id, topic, actor_user_id, occurred_at, received_at, source, ip, ua, payload)
       values ($1,$2,$3, now(), now(), 'app', $4, $5, $6)`,
      [ulid(), "video_beat", userId, ip, ua, payload]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("video heartbeat error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// POST /video/:itemId/playback-token
// Emite token Mux apenas se usuário tiver entitlement ao curso do itemId
router.post("/:itemId/playback-token", async (req: Request, res: Response) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  if (process.env.DEV_FAKE === "1") {
    // token fake para desenvolvimento sem Mux
    return res.json({ token: "dev-token" });
  }

  const itemId = req.params.itemId;

  const client = await pool.connect();
  try {
    // resolve item -> módulo -> curso
    const { rows: rowsMap } = await client.query(
      `
      select mi.id as item_id, mi.payload_ref, m.course_id
      from module_items mi
      join modules m on m.id = mi.module_id
      where mi.id = $1
      `,
      [itemId]
    );
    if (rowsMap.length === 0) return res.status(404).json({ error: "item_not_found" });
    const row = rowsMap[0];

    // entitlement ao curso
    const { rows: ent } = await client.query(
      `select 1 from entitlements where user_id = $1 and course_id = $2`,
      [userId, row.course_id]
    );
    if (ent.length === 0) return res.status(403).json({ error: "no_entitlement" });

    // pega playback id do payload_ref
    const pr = row.payload_ref as any;
    const playbackId =
      pr?.mux_playback_id || pr?.muxPlaybackId || pr?.playback_id || String(itemId);

    const keyId = process.env.MUX_SIGNING_KEY_ID!;
    const privateKey = (process.env.MUX_SIGNING_KEY_PRIVATE || "").replace(/\\n/g, "\n");
    if (!keyId || !privateKey) return res.status(500).json({ error: "mux_signing_missing" });

    const header: JwtHeader = {
      alg: "RS256",
      kid: keyId,
      typ: "JWT",
    };

    const token = jwt.sign(
      {
        aud: "v",
        sub: playbackId,
        exp: Math.floor(Date.now() / 1000) + 60 * 10,
      },
      privateKey,
      { algorithm: "RS256", header }
    );

    return res.json({ token });
  } finally {
    client.release();
  }
});

export default router;
