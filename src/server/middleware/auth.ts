// src/server/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

type Claims = { sub?: string; email?: string };

function readCookie(name: string, cookieHeader?: string) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const hdr = req.headers.authorization || "";
  const tokenFromBearer = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(500).json({ error: "jwt_secret_missing" });

  let token = tokenFromBearer;

  // Fallback: cookie "session" quando COOKIE_MODE=1 e não veio Bearer
  if (!token && process.env.COOKIE_MODE === "1") {
    token = readCookie("session", req.headers.cookie || "") || "";
  }

  if (!token) return res.status(401).json({ error: "no_token" });

  try {
    const decoded = jwt.verify(token, secret) as Claims;
    req.auth = { userId: decoded.sub, email: decoded.email };
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}
