// src/server/routes/certificates.ts
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { pool } from "../lib/db.js";
import { ulid } from "ulid";
import { paramUuid } from "../utils/ids.js";

const router = Router();

// valida o courseId do path
router.use("/:courseId", paramUuid("courseId"));

// POST /certificates/:courseId/issue
// Regra: precisa entitlement e todos módulos do curso com status 'passed' ou 'completed'
router.post("/:courseId/issue", async (req: Request, res: Response) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  const { courseId } = req.params;

  const client = await pool.connect();
  try {
    await client.query("begin");

    // entitlement
    const { rows: ent } = await client.query(
      `select 1 from entitlements where user_id = $1 and course_id = $2`,
      [userId, courseId]
    );
    if (ent.length === 0) {
      await client.query("rollback");
      return res.status(403).json({ error: "no_entitlement" });
    }

    // módulos do curso e progresso
    const { rows: mods } = await client.query(
      `
      select m.id as module_id,
             coalesce(p.status,'started') as status
      from modules m
      left join progress p on p.module_id = m.id and p.user_id = $1
      where m.course_id = $2
      order by m."order" asc
      `,
      [userId, courseId]
    );
    if (mods.length === 0) {
      await client.query("rollback");
      return res.status(400).json({ error: "course_without_modules" });
    }
    const allPassed = mods.every((m) => ["passed", "completed"].includes(m.status));
    if (!allPassed) {
      await client.query("rollback");
      return res.status(403).json({ error: "course_not_completed" });
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
