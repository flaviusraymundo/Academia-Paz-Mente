// src/server/routes/certificates.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { isUuid } from "../utils/ids.js";
import { issueCertificate } from "../lib/certificates.js";

type Auth = { userId?: string; email?: string; isAdmin?: boolean };
interface AuthReq extends Request { auth?: Auth }

export const certificatesPublic = Router();
export const certificatesPrivate = Router();

/* ============================
 * Público: verificação por SERIAL
 * GET /api/certificates/verify/:serial
 * 200 se existir, 404 se não
 * ============================ */
certificatesPublic.get("/:serial", async (req: Request, res: Response) => {
  const serial = String(req.params.serial || "").trim();
  if (!serial) return res.status(400).json({ error: "serial_required" });

  try {
    const { rows } = await pool.query(
      `select user_id, course_id, asset_url as pdf_url, issued_at, serial, serial_hash as hash
         from certificate_issues
        where serial = $1
        limit 1`,
      [serial]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    return res.json(rows[0]);
  } catch (e) {
    return res.status(500).json({ error: "verify_failed" });
  }
});

/* ============================
 * Público: verificação por HASH
 * GET /api/certificates/verify?hash=...
 * ============================ */
certificatesPublic.get("/", async (req: Request, res: Response) => {
  const hash = String(req.query.hash || "").trim();
  if (!hash) return res.status(400).json({ error: "hash_required" });

  try {
    const { rows } = await pool.query(
      `select user_id, course_id, asset_url as pdf_url, issued_at, serial, serial_hash as hash
         from certificate_issues
        where serial_hash = $1
        limit 1`,
      [hash]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    return res.json(rows[0]);
  } catch {
    return res.status(500).json({ error: "verify_failed" });
  }
});

/* ============================
 * Privado: listar certificados do aluno autenticado
 * GET /api/certificates
 * Resposta estável: { certificates: [...] }
 * ============================ */
certificatesPrivate.get("/", async (req: AuthReq, res: Response) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const sql = `
    select course_id, asset_url as pdf_url, issued_at, serial, serial_hash as hash
      from certificate_issues
     where user_id = $1
    union all
    select course_id, pdf_url, issued_at, null::text as serial, hash
      from certificates
     where user_id = $1
     order by issued_at desc
  `;

  try {
    const { rows } = await pool.query(sql, [userId]);
    return res.json({ certificates: rows });
  } catch {
    return res.status(500).json({ error: "list_failed" });
  }
});

/* ============================
 * Privado: emitir certificado do curso
 * POST /api/certificates/:courseId/issue
 * Query: reissue=1, keepIssuedAt=1 (opcional)
 * ============================ */
certificatesPrivate.post("/:courseId/issue", async (req: AuthReq, res: Response) => {
  const userId = req.auth?.userId;
  const courseId = String(req.params.courseId || "");
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_course_id" });

  const reissue = String(req.query.reissue || "") === "1";
  const keepIssuedAt = String(req.query.keepIssuedAt || "") === "1";
  const fullName = typeof req.query.fullName === "string" ? req.query.fullName : undefined;

  try {
    await pool.query("begin");
    await issueCertificate({
      client: null, // compat: lib usa pool internamente ou recebe client opcional
      userId,
      courseId,
      reissue,
      keepIssuedAt,
      fullName,
    });

    const { rows } = await pool.query(
      `select id, user_id, course_id, asset_url as pdf_url, issued_at, serial, serial_hash as hash
         from certificate_issues
        where user_id = $1 and course_id = $2
        order by issued_at desc
        limit 1`,
      [userId, courseId]
    );

    if (!rows.length) {
      await pool.query("rollback");
      return res.status(500).json({ error: "issue_failed" });
    }

    await pool.query("commit");
    const row = rows[0];
    const verifyBase = "/api/certificates/verify";
    const verifyUrl = row.serial
      ? `${verifyBase}/${row.serial}`
      : `${verifyBase}?hash=${encodeURIComponent(row.hash)}`;

    return res.json({ ...row, verifyUrl });
  } catch (e: any) {
    try { await pool.query("rollback"); } catch {}
    const detail = process.env.DEBUG_CERTS ? String(e?.message || e) : undefined;
    return res.status(500).json(detail ? { error: "issue_failed", detail } : { error: "issue_failed" });
  }
});
