// src/server/routes/certificates.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { hasActiveCourseEntitlement } from "../lib/entitlements.js";
import { allModulesPassed } from "../lib/progress.js";
import { isUuid } from "../utils/ids.js";
import { issueCertificate } from "../lib/certificates.js";

const DEBUG_CERTS = process.env.DEBUG_CERTS === "1";

// Tipagem simples para req.auth sem precisar de @ts-expect-error
interface AuthReq extends Request {
  auth?: { userId?: string; roles?: string[] };
}

// Separa routers:
// - Público: apenas /verify
// - Privado (autenticado): emissão e listagem
export const certificatesPublic = Router();
export const certificatesPrivate = Router();

// GET /api/certificates/verify/:serial (público)
certificatesPublic.get("/:serial", async (req: Request, res: Response) => {
  const serial = String(req.params.serial || "").trim();
  if (!serial) return res.status(400).json({ error: "invalid_serial" });

  const { rows } = await pool.query(
    `select id,
            user_id,
            course_id,
            issued_at,
            full_name,
            asset_url as pdf_url,
            serial,
            serial_hash as hash
       from certificate_issues
      where serial = $1
      limit 1`,
    [serial],
  );
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  return res.json(rows[0]);
});

// GET /api/certificates/verify?hash=... (público)
certificatesPublic.get("/", async (req: Request, res: Response) => {
  const hash = String(req.query.hash || "").trim();
  if (!hash) return res.status(400).json({ error: "missing_hash" });

  const { rows } = await pool.query(
    `select id,
            user_id,
            course_id,
            issued_at,
            full_name,
            asset_url as pdf_url,
            serial,
            serial_hash as hash
       from certificate_issues
      where serial_hash = $1
      limit 1`,
    [hash],
  );
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  return res.json(rows[0]);
});

// GET / — lista certificados emitidos ao aluno (novo + legado)
certificatesPrivate.get("/", async (req: AuthReq, res: Response) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const sql = `
    select course_id, asset_url as pdf_url, issued_at, serial, serial_hash as hash
      from certificate_issues
     where user_id = $1
    union all
    select course_id, pdf_url, issued_at, null as serial, hash
      from certificates
     where user_id = $1
     order by issued_at desc
  `;

  try {
    const { rows } = await pool.query(sql, [userId]);
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({
      error: "list_failed",
      ...(DEBUG_CERTS ? { detail: e?.message || String(e) } : {}),
    });
  }
});

// POST /certificates/:courseId/issue
// Regra: precisa entitlement e todos módulos do curso com status 'passed' ou 'completed'
certificatesPrivate.post("/:courseId/issue", async (req: AuthReq, res: Response) => {
  const userId = req.auth?.userId;
  const { courseId } = req.params;
  const reissue = String(req.query.reissue ?? "") === "1";
  const keepIssuedAt = String(req.query.keepIssuedAt ?? "") === "1";

  if (!userId || !courseId) {
    return res.status(400).json({ error: "bad_request" });
  }

  if (!isUuid(courseId)) {
    return res.status(400).json({ error: "invalid_id", param: "courseId" });
  }

  const client = await pool.connect();
  let tx = false;
  try {
    await client.query("begin");
    tx = true;

    if (process.env.ENTITLEMENTS_ENFORCE === "1") {
      const ok = await hasActiveCourseEntitlement(client, userId, courseId);
      if (!ok) {
        await client.query("rollback");
        tx = false;
        return res.status(403).json({ error: "no_entitlement" });
      }
    }

    const hasModules = await client.query(
      `select 1 from modules where course_id=$1 limit 1`,
      [courseId]
    );
    if (hasModules.rowCount === 0) {
      await client.query("rollback");
      tx = false;
      return res.status(400).json({ error: "course_without_modules" });
    }

    const passed = await allModulesPassed(client, userId, courseId);
    if (!passed) {
      await client.query("rollback");
      tx = false;
      return res.status(422).json({ error: "not_eligible" });
    }

    let fullName: string | null = null;
    try {
      const profileRes = await client.query<{ full_name: string | null }>(
        `select full_name from profiles where user_id=$1 limit 1`,
        [userId]
      );
      fullName = profileRes.rows[0]?.full_name ?? null;
    } catch {
      fullName = null;
    }

    await issueCertificate({
      client,
      userId,
      courseId,
      assetUrl: null,
      fullName,
      reissue,
      keepIssuedAt,
    });

    const { rows } = await client.query(
      `select id,
              user_id,
              course_id,
              issued_at,
              full_name,
              asset_url,
              serial,
              serial_hash
         from certificate_issues
        where user_id = $1 and course_id = $2
        limit 1`,
      [userId, courseId]
    );

    if (!rows.length) {
      await client.query("rollback");
      tx = false;
      return res.status(500).json({ error: "issue_failed" });
    }

    await client.query("commit");
    tx = false;

    const row = rows[0] as any;
    const serial = typeof row.serial === "string" ? row.serial : null;
    const rawHash =
      (typeof row.serial_hash === "string" ? row.serial_hash : null) ??
      (typeof row.hash === "string" ? row.hash : null);
    const hash = rawHash ?? null;
    const rawPdfUrl =
      (typeof row.asset_url === "string" ? row.asset_url : null) ??
      (typeof row.pdf_url === "string" ? row.pdf_url : null);
    const pdfUrl = rawPdfUrl ?? null;
    const verifyUrl = serial
      ? `/api/certificates/verify/${serial}`
      : hash
        ? `/api/certificates/verify?hash=${encodeURIComponent(hash)}`
        : null;

    return res.json({
      id: row.id,
      userId: row.user_id,
      courseId: row.course_id,
      issuedAt: row.issued_at,
      fullName: row.full_name ?? null,
      pdfUrl,
      serial,
      hash,
      verifyUrl,
    });
  } catch (e: any) {
    if (tx) {
      try {
        await client.query("rollback");
      } catch {
        // ignore rollback errors
      }
    }
    return res.status(500).json({
      error: "issue_failed",
      ...(DEBUG_CERTS ? { detail: e?.message || String(e) } : {}),
    });
  } finally {
    client.release();
  }
});

// Exporta ambos
export default {
  certificatesPublic,
  certificatesPrivate,
};
