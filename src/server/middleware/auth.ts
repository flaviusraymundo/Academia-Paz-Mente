// src/server/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export type AuthUser = { userId: string; email?: string };

declare module "express-serve-static-typescript" {}
declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthUser;
  }
}

const { JWT_SECRET } = process.env;
if (!JWT_SECRET) throw new Error("JWT_SECRET missing");

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization || "";
  const [, token] = h.split(" ");
  if (!token) return res.status(401).json({ error: "unauthorized" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (!decoded?.sub) return res.status(401).json({ error: "unauthorized" });
    req.auth = { userId: String(decoded.sub), email: decoded.email };
    return next();
  } catch {
    return res.status(401).json({ error: "unauthorized" });
  }
}
