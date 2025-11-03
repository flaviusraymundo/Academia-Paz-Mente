// src/server/routes/video.ts
import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
// Valide entitlement e ownership do item antes de emitir

const router = Router();
router.post("/:itemId/playback-token", async (req: Request, res: Response) => {
  // TODO: validar user e entitlement ao course do itemId
  const keyId = process.env.MUX_SIGNING_KEY_ID!;
  const privateKey = (process.env.MUX_SIGNING_KEY_PRIVATE || "").replace(/\\n/g, "\n");

  const token = jwt.sign(
    {
      aud: "v", // video
      sub: req.params.itemId, // playback-id ou policy ID conforme setup
      kid: keyId,
      exp: Math.floor(Date.now() / 1000) + 60 * 10 // 10 min
    },
    privateKey,
    { algorithm: "RS256", header: { kid: keyId, typ: "JWT" } }
  );

  res.json({ token });
});

export default router;
