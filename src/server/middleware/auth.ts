// src/server/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const COOKIE_MODE = process.env.COOKIE_MODE === "1";
const JWT_SECRET = process.env.JWT_SECRET || process.env.DEV_JWT_SECRET;

type Claims = {
  sub?: string;
  email?: string;
  isAdmin?: boolean;
};

function readSessionCookie(req: Request): string | null {
  const raw = req.headers.cookie || "";
  if (!raw) return null;
  const match = raw.match(/(?:^|;\s*)session=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  let token: string | undefined | null;

  if (COOKIE_MODE) {
    token = readSessionCookie(req);
  } else {
    const h = req.headers.authorization || "";
    if (h.startsWith("Bearer ")) token = h.slice(7);
  }

  if (!token) return res.status(401).json({ error: "no_token" });
  if (!JWT_SECRET) return res.status(500).json({ error: "jwt_secret_missing" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as Claims;
    req.auth = { userId: decoded.sub, email: decoded.email, isAdmin: !!decoded.isAdmin };
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}
