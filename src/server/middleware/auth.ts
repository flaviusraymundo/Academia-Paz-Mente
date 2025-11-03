import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

type Claims = {
  sub?: string;
  email?: string;
};

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (!token) return res.status(401).json({ error: "no_token" });

  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(500).json({ error: "jwt_secret_missing" });

  try {
    const decoded = jwt.verify(token, secret) as Claims;
    req.auth = { userId: decoded.sub, email: decoded.email };
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}
