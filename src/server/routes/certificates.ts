// src/server/routes/certificates.ts
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { pool, withClient } from "../lib/db.js";
import { hasActiveCourseEntitlement } from "../lib/entitlements.js";
import { allModulesPassed } from "../lib/progress.js";
import { ulid } from "ulid";
import { isUuid } from "../utils/ids.js";

const router = Router();

// GET /api/certificates — lista certificados emitidos ao aluno
router.get("/", async (req: Request, res: Response) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const certificates = await withClient(async (client) => {
    const { rows } = await client.query<{
      course_id: string;
      asset_url: string;
      issued_at: string;
      title: string;
    }>(
      `select c.course_id, c.pdf_url as asset_url, c.issued_at, crs.title
         from certificates c
         join courses crs on crs.id = c.course_id
        where c.user_id = $1
        order by c.issued_at desc`,
      [userId]
    );
    return rows;
  });
  return res.json({ certificates });
});

// POST /certificates/:courseId/issue
// Regra: precisa entitlement e todos módulos do curso com status 'passed' ou 'completed'
router.post("/:courseId/issue", async (req: Request, res: Response) => {
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

    // já existe?
    const { rows: existing } = await client.query(
      `select id, user_id, course_id, issued_at, hash, pdf_url
       from certificates
       where user_id = $1 and course_id = $2`,
      [userId, courseId]
    );
    if (existing.length > 0) {
      await client.query("commit");
      return res.json(existing[0]);
    }

    // gera hash e stub de URL do PDF
    const issuedAt = new Date();
    const payloadToHash = JSON.stringify({ userId, courseId, issuedAt: issuedAt.toISOString() });
    const hash = crypto.createHash("sha256").update(payloadToHash).digest("hex");

    // TODO: gerar PDF real e obter URL de storage assinado
    const pdfUrl = `https://storage.seudominio.com/certs/${hash}.pdf`;

    const { rows: certs } = await client.query(
      `insert into certificates(user_id, course_id, issued_at, hash, pdf_url)
       values ($1,$2,$3,$4,$5)
       returning id, user_id, course_id, issued_at, hash, pdf_url`,
      [userId, courseId, issuedAt, hash, pdfUrl]
    );

    const eventId = ulid();
    await client.query(
      `insert into event_log(event_id, topic, actor_user_id, entity_type, entity_id, occurred_at, source, payload)
       values ($1,'certificate.issued',$2,'course',$3, now(),'app', $4)`,
      [eventId, userId, courseId, { certificateId: certs[0].id, hash }]
    );

    await client.query("commit");
    return res.json(certs[0]);
  } catch (e) {
    await client.query("rollback");
    return res.status(500).json({ error: "issue_failed" });
  } finally {
    client.release();
  }
});

export default router;
