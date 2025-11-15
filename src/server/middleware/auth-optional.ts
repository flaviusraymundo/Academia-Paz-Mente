// src/server/middleware/auth-optional.ts
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

function readBearer(req: Request): string | null {
  const h = (req.get("authorization") || req.get("Authorization")) ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function readSessionCookie(req: Request): string | null {
  const raw = req.headers.cookie || "";
  if (!raw) return null;
  const m = raw.match(/(?:^|;\s*)session=([^;]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

// Anexa req.auth se houver token (header ou cookie). Nunca lança erro.
export function attachAuthIfPresent(req: Request, _res: Response, next: NextFunction) {
  const secret =
    process.env.JWT_SECRET ||
    process.env.DEV_JWT_SECRET ||
    "";
  if (!secret) return next();

  const token = readBearer(req) || readSessionCookie(req);
  if (!token) return next();

  try {
    const payload = jwt.verify(token, secret) as any;
    (req as any).auth = {
      userId: payload.sub || payload.userId || payload.uid,
      email: payload.email,
      isAdmin: Boolean(payload.isAdmin),
    };
  } catch {
    // token inválido: segue sem auth
  }
  next();
}
