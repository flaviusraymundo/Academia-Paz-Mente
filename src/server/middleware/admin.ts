// src/server/middleware/admin.ts
import { Request, Response, NextFunction } from "express";

/**
 * Permite acesso somente a e-mails listados em ADMIN_EMAILS (CSV) ou
 * a todos os usuários se ADMIN_OPEN=1 (apenas para dev).
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const open = process.env.ADMIN_OPEN === "1";
  if (open) return next();

  const email = req.auth?.email?.toLowerCase() || "";
  const csv = (process.env.ADMIN_EMAILS || "").toLowerCase();
  const allow = csv.split(",").map((s) => s.trim()).filter(Boolean);
  if (email && allow.includes(email)) return next();

  return res.status(403).json({ error: "admin_only" });
}
