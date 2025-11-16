// src/server/routes/video.ts
import { Router, Request, Response } from "express";
import jwt, { JwtHeader } from "jsonwebtoken";
import { pool, withClient } from "../lib/db";
import { hasActiveCourseEntitlement } from "../lib/entitlements";
import { ulid } from "ulid";
import { isUuid } from "../utils/ids";

const router = Router();

// POST /video/heartbeat  (montado também como /api/video/heartbeat)
// registra batimentos de vídeo em event_log (depois podemos consolidar em video_sessions)
router.post("/heartbeat", async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId || null; // /video já exige auth via app.ts
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const { courseId, moduleId, itemId, secs } = req.body || {};
    if (!isUuid(courseId)) {
      return res.status(400).json({ error: "invalid_id", param: "courseId" });
    }
    if (!isUuid(moduleId)) {
      return res.status(400).json({ error: "invalid_id", param: "moduleId" });
    }
    if (!isUuid(itemId)) {
      return res.status(400).json({ error: "invalid_id", param: "itemId" });
    }
    if (!Number.isFinite(secs) || secs <= 0) return res.status(400).json({ error: "bad_secs" });

    // Gate de entitlement ativo (opcional via ENV)
    if (process.env.ENTITLEMENTS_ENFORCE === "1") {
      const ok = await withClient((client) =>
        hasActiveCourseEntitlement(client, userId, courseId)
      );
      if (!ok) return res.status(403).json({ error: "no_entitlement" });
    }
    const ua = (req.headers["user-agent"] as string) || null;
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
    const payload = {
      courseId,
      moduleId,
      itemId,
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
  if (!isUuid(itemId)) {
    return res.status(400).json({ error: "invalid_id", param: "itemId" });
  }

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

    // entitlement ao curso (direto ou via trilha, apenas ativos)
    const hasAccess = await hasActiveCourseEntitlement(
      client,
      userId,
      row.course_id
    );
    if (!hasAccess) return res.status(403).json({ error: "no_entitlement" });

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
