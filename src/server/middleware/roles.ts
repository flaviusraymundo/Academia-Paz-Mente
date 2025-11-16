import { withClient } from "../lib/db";
import type { Request, Response, NextFunction } from "express";
import type { QueryResult } from "pg";

type AllowedRole = 'student' | 'instructor' | 'admin';
interface AuthData { userId?: string; email?: string; }
interface RoleRequest extends Request { auth?: AuthData; role?: AllowedRole; }

export function requireRole(...allowed: AllowedRole[]) {
  return async (req: RoleRequest, res: Response, next: NextFunction) => {
    const userId: string | undefined = req.auth?.userId;
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    try {
      const r: QueryResult<{ role: string }> = await withClient(c =>
        c.query<{ role: string }>(
          `SELECT role FROM user_roles WHERE user_id = $1 LIMIT 1`,
          [userId]
        )
      );
      const rawRole = r.rows[0]?.role;
      const role: AllowedRole =
        rawRole && (['student','instructor','admin'] as string[]).includes(rawRole)
          ? (rawRole as AllowedRole)
          : 'student';
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
