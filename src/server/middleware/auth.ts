// src/server/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

type Claims = {
  sub?: string;
  email?: string;
  isAdmin?: boolean;
};

function readBearer(req: Request): string | null {
  const hdr = req.headers.authorization || req.headers.Authorization as string | undefined || "";
  if (!hdr) return null;
  return hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
}

function readSessionCookie(req: Request): string | null {
  const raw = req.headers.cookie || "";
  if (!raw) return null;
  // procura "session=..."
  const m = raw.match(/(?:^|;\s*)session=([^;]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // 1) tenta Bearer
  let token = readBearer(req);

  // 2) se não houver Bearer, tenta cookie "session"
  if (!token) token = readSessionCookie(req);

  if (!token) return res.status(401).json({ error: "no_token" });

  const secret =
    process.env.JWT_SECRET ||
    process.env.DEV_JWT_SECRET; // compatível com cookie mode do Next
  if (!secret) return res.status(500).json({ error: "jwt_secret_missing" });

  try {
    const decoded = jwt.verify(token, secret) as Claims;
    req.auth = { userId: decoded.sub, email: decoded.email, isAdmin: !!decoded.isAdmin };
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}
