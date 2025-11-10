import { withClient } from "../lib/db.js";
import type { Request, Response, NextFunction } from "express";

export function requireRole(...allowed: Array<'student'|'instructor'|'admin'>) {
  return async (req: Request & { auth?: any; role?: string }, res: Response, next: NextFunction) => {
    // @ts-expect-error auth injetado pelo middleware existente (requireAuth)
    const userId: string | undefined = req.auth?.userId;
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    try {
      const r = await withClient(c =>
        c.query(`SELECT role FROM user_roles WHERE user_id = $1`, [userId])
      );
      const role = (r.rows[0]?.role as string | undefined) || "student";
      if (!allowed.includes(role)) {
        return res.status(403).json({ error: "forbidden" });
      }
      req.role = role;
      return next();
    } catch (e) {
      console.error("requireRole error", e);
      return res.status(500).json({ error: "server_error" });
    }
  };
}
