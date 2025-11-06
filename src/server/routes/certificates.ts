// src/server/routes/certificates.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import { hasActiveCourseEntitlement } from "../lib/entitlements.js";
import { allModulesPassed } from "../lib/progress.js";
import { isUuid } from "../utils/ids.js";
import { requireAuth } from "../middleware/auth.js";
import { issueCertificate } from "../lib/certificates.js";

const router = Router();

// GET /api/certificates/verify/:serial (público)
router.get("/verify/:serial", async (req: Request, res: Response) => {
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
router.get("/verify", async (req: Request, res: Response) => {
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

// GET /api/certificates — lista certificados emitidos ao aluno (lê de certificate_issues)
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  // Padrão atual: certificate_issues (novo) + compat com 'certificates' (legado).
  // Campos padronizados na resposta: course_id, pdf_url, issued_at, serial, hash
  const { rows } = await pool.query<{
    course_id: string;
    pdf_url: string | null;
    issued_at: string;
    serial: string | null;
    hash: string | null;
  }>(
    `
    select
      ci.course_id,
      ci.asset_url                     as pdf_url,
      ci.issued_at,
      ci.serial,
      ci.serial_hash                   as hash
    from certificate_issues ci
    where ci.user_id = $1
    union all
    select
      c.course_id,
      c.pdf_url,
      c.issued_at,
      null::text                       as serial,
      null::text                       as hash
    from certificates c
    where c.user_id = $1
    order by issued_at desc
    `,
    [userId]
  );

  return res.json({ certificates: rows });
});

// POST /certificates/:courseId/issue
// Regra: precisa entitlement e todos módulos do curso com status 'passed' ou 'completed'
router.post("/:courseId/issue", requireAuth, async (req: Request, res: Response) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  const { courseId } = req.params;
  if (!isUuid(courseId)) {
    return res.status(400).json({ error: "invalid_id", param: "courseId" });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");

    // Gate opcional por entitlement ativo
    if (process.env.ENTITLEMENTS_ENFORCE === "1") {
      const ok = await hasActiveCourseEntitlement(client, userId, courseId);
      if (!ok) {
        await client.query("rollback");
        return res.status(403).json({ error: "no_entitlement" });
      }
    }

    // precisa existir ao menos um módulo
    const hasModules = await client.query(
      `select 1 from modules where course_id=$1 limit 1`,
      [courseId]
    );
    if (hasModules.rowCount === 0) {
      await client.query("rollback");
      return res.status(400).json({ error: "course_without_modules" });
    }

    const passed = await allModulesPassed(client, userId, courseId);
    if (!passed) {
      await client.query("rollback");
      return res.status(422).json({ error: "not_eligible" });
    }

    await issueCertificate({
      client,
      userId,
      courseId,
      assetUrl: null,
      fullName: null,
      reissue: false,
      keepIssuedAt: false,
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
      return res.status(500).json({ error: "issue_failed" });
    }

    await client.query("commit");

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
  } catch (e) {
    await client.query("rollback");
    return res.status(500).json({ error: "issue_failed" });
  } finally {
    client.release();
  }
});

export default router;
