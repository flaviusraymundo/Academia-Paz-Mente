// src/server/routes/certificates.ts
import { Router, Response } from "express";
import type { Request } from "express";
import { pool, withClient } from "../lib/db.js";
import { isUuid } from "../utils/ids.js";
import { issueCertificate } from "../lib/certificates.js";

// Base pública para montar links absolutos
function publicBase(req: Request) {
  const env = (process.env.APP_BASE_URL || process.env.URL || "").trim().replace(/\/+$/, "");
  if (env) return env; // Produção: use o domínio principal configurado pelo Netlify (URL) ou APP_BASE_URL
  // Prefira cabeçalhos do proxy. Só caia para Host local se necessário.
  const fHost = (req.headers["x-forwarded-host"] as string) || "";
  const host = fHost || req.get("host") || "";
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  return `${proto}://${host}`;
}

function buildPdfUrl(base: string, userId: string, courseId: string, hash?: string | null) {
  const suffix = hash ? `?h=${hash}` : "";
  return `${base}/api/certificates/${userId}/${courseId}.pdf${suffix}`;
}

function escapeHtml(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
  const wantsHtml =
    /\btext\/html\b/i.test(req.get("accept") || "") || String(req.query.view || "") === "1";

  try {
    const { rows } = await pool.query(
      `select ci.user_id,
              ci.course_id,
              ci.asset_url as pdf_url,
              ci.issued_at,
              ci.serial,
              ci.serial_hash as hash,
              ci.full_name,
              coalesce(c.title, '') as course_title
         from certificate_issues ci
         left join courses c on c.id = ci.course_id
        where ci.serial = $1
        limit 1`,
      [serial]
    );
    if (!rows.length) {
      if (wantsHtml) return res.status(404).send("<h1>Não encontrado</h1>");
      return res.status(404).json({ error: "not_found" });
    }

    const row = rows[0];
    const base = publicBase(req);
    const pdfUrl = buildPdfUrl(base, row.user_id, row.course_id, row.hash);
    if (wantsHtml) {
      const safeSerial = escapeHtml(serial);
      const safeName = escapeHtml(row.full_name || "Aluno");
      const safeCourse = escapeHtml(row.course_title || "Curso");
      const safePdf = escapeHtml(pdfUrl);
      const html = `<!doctype html><meta charset="utf-8">
<title>Verificação de Certificado</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.45 system-ui,-apple-system,'Segoe UI',Roboto;max-width:640px;margin:24px auto;padding:0 16px}
a.button{display:inline-block;padding:10px 14px;border:1px solid #0f5132;border-radius:8px;text-decoration:none}
.ok{color:#155724;background:#d4edda;border-color:#c3e6cb;padding:12px 14px;border-radius:8px;margin:12px 0}
h1{color:#0f5132;font-size:1.75rem;margin-bottom:12px}</style>
<h1>Certificado válido</h1>
<div class="ok">Serial: <b>${safeSerial}</b></div>
<p><b>${safeName}</b><br>${safeCourse}</p>
<p><a class="button" href="${safePdf}" target="_blank" rel="noopener">Abrir PDF</a></p>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }
    return res.json({ ...row, pdf_url: pdfUrl });
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

    const row = rows[0];
    const base = publicBase(req);
    const pdfUrl = buildPdfUrl(base, row.user_id, row.course_id, row.hash);
    return res.json({ ...row, pdf_url: pdfUrl });
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

  const unique = String(req.query.unique || "") === "1";
  const sql = unique
    ? `
      with merged as (
        select course_id, asset_url as pdf_url, issued_at, serial, serial_hash as hash, 1 as prio
          from certificate_issues where user_id = $1
        union all
        select course_id, pdf_url, issued_at, null::text as serial, hash, 2 as prio
          from certificates where user_id = $1
      )
      select distinct on (course_id) course_id, pdf_url, issued_at, serial, hash
        from merged
       order by course_id, prio, issued_at desc
    `
    : `
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
    const base = publicBase(req);
    const certificates = rows.map((row: any) => ({
      ...row,
      pdf_url: buildPdfUrl(base, userId, row.course_id, row.hash),
    }));
    return res.json({ certificates });
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
  const fullNameQ =
    typeof req.query.fullName === "string" ? req.query.fullName.trim() : undefined;
  const fullName = fullNameQ && fullNameQ.length > 0 ? fullNameQ : undefined;

  try {
    const row = await withClient((client) =>
      issueCertificate({
        client,
        userId,
        courseId,
        reissue,
        keepIssuedAt,
        fullName,
      })
    );

    const base = publicBase(req);
    const verifyUrl = row.serial ? `${base}/api/certificates/verify/${row.serial}` : null;
    const pdfUrl = buildPdfUrl(base, row.user_id, row.course_id, row.hash);

    return res.json({
      id: row.id,
      user_id: row.user_id,
      course_id: row.course_id,
      issued_at: row.issued_at,
      pdf_url: pdfUrl,
      serial: row.serial ?? null,
      hash: row.hash ?? null,
      verifyUrl,
      reissue,
      keepIssuedAt,
    });
  } catch (e: any) {
    const detail = process.env.DEBUG_CERTS === "1" ? String(e?.message || e) : undefined;
    if (detail) {
      return res.status(500).json({ error: "issue_failed", detail });
    }
    return res.status(500).json({ error: "issue_failed" });
  }
});
