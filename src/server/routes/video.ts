// src/server/routes/video.ts
import { Router, Request, Response } from "express";
import jwt, { JwtHeader } from "jsonwebtoken";
import { pool } from "../lib/db.js";

const router = Router();

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
