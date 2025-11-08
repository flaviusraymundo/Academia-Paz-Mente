// src/server/middleware/auth-optional.ts
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Anexa req.auth se houver Bearer. Nunca lança erro nem exige token.
export function attachAuthIfPresent(req: Request, _res: Response, next: NextFunction) {
  const h = req.get("authorization") || req.get("Authorization");
  const m = h && h.match(/^Bearer\s+(.+)$/i);
  if (!m) return next();

  const secret = process.env.JWT_SECRET || process.env.JWT_TOKEN_SECRET || "";
  if (!secret) return next();

  try {
    const payload = jwt.verify(m[1], secret) as any;
    (req as any).auth = {
      userId: payload.userId || payload.sub || payload.uid,
      email: payload.email,
      isAdmin: Boolean(payload.isAdmin),
    };
  } catch {
    // token inválido: segue sem auth
  }
  next();
}
