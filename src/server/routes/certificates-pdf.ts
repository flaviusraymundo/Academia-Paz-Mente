// src/server/routes/certificates-pdf.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { isUuid } from "../utils/ids.js";

const router = Router();

type MaybeAuth = { userId?: string; email?: string; isAdmin?: boolean };

type Row = {
  user_id: string;
  course_id: string;
  full_name: string | null;
  issued_at: string; // timestamptz
  serial: string;
  course_title: string | null;
};

function formatPtBrDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
  // Ex.: "07 de novembro de 2025"
  return parts;
}

function buildHtml(params: {
  fullName: string;
  courseTitle: string;
  city: string;
  issuedAt: Date;
}): string {
  const { fullName, courseTitle, city, issuedAt } = params;
  const issuedStr = `${city}, ${formatPtBrDate(issuedAt)}`;

  // Template fornecido pelo usuário, com placeholders injetados
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <!-- templates/certificate.html -->
  <meta charset="UTF-8">
  <title>Certificado</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{
      font-family:'Georgia', serif;
      background:linear-gradient(135deg,#e0f2f1 0%,#b2dfdb 100%);
      display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px;
    }
    .certificate{
      width:900px;background:#fff;padding:60px;position:relative;
      box-shadow:0 10px 40px rgba(0,0,0,.2);
    }
    .certificate::before{
      content:'';position:absolute;top:20px;left:20px;right:20px;bottom:20px;border:3px solid #26a69a;pointer-events:none;
    }
    .certificate::after{
      content:'';position:absolute;top:30px;left:30px;right:30px;bottom:30px;border:1px solid #80cbc4;pointer-events:none;
    }
    /* ===== Corners dourados — 1 desenho, 4 rotações ===== */
    :root{
      --corner:78px;
      --stroke:3px;
      --gap:28px;
      --gold:#b49a54;
    }
    .corner{
      position:absolute;
      width:var(--corner);
      height:var(--corner);
      color:var(--gold);
    }
    .corner::before,
    .corner::after{
      content:"";
      position:absolute;
      background:currentColor;
      border-radius:2px;
    }
    .corner::before{
      top:0;left:0;
      width:100%;
      height:var(--stroke);
    }
    .corner::after{
      top:0;left:0;
      width:var(--stroke);
      height:100%;
    }
    .corner-tl{top:var(--gap);left:var(--gap);transform:rotate(0deg);transform-origin:0 0}
    .corner-tr{top:var(--gap);right:var(--gap);transform:rotate(90deg);transform-origin:100% 0}
    .corner-br{bottom:var(--gap);right:var(--gap);transform:rotate(180deg);transform-origin:100% 100%}
    .corner-bl{bottom:var(--gap);left:var(--gap);transform:rotate(270deg);transform-origin:0 100%}
    .content{position:relative;z-index:1;text-align:center}
    .header{margin-bottom:30px}
    .title{font-size:48px;color:#26a69a;font-weight:bold;letter-spacing:4px;margin-bottom:10px;text-transform:uppercase}
    .subtitle{font-size:18px;color:#4db6ac;font-style:italic}
    .divider{width:200px;height:2px;background:linear-gradient(to right,transparent,#26a69a,transparent);margin:30px auto}
    .body-text{font-size:16px;color:#333;line-height:1.8;margin:20px 0}
    .recipient-name{font-size:36px;color:#26a69a;font-weight:bold;margin:30px 0;font-style:italic;text-decoration:underline;text-decoration-color:#80cbc4;text-underline-offset:8px}
    .achievement{font-size:18px;color:#555;margin:25px auto;line-height:1.6;max-width:600px}
    .footer{margin-top:50px;display:flex;justify-content:space-around;align-items:flex-end}
    .signature-block{text-align:center}
    .signature-line{width:200px;height:1px;background:#26a69a;margin:40px auto 10px}
    .signature-name{font-size:16px;color:#333;font-weight:bold}
    .signature-title{font-size:14px;color:#666;font-style:italic}
    .date{font-size:14px;color:#666;margin-top:30px}
    .seal{
      position:absolute;bottom:50px;right:80px;width:80px;height:80px;border:3px solid #26a69a;border-radius:50%;
      display:flex;align-items:center;justify-content:center;font-size:12px;color:#26a69a;font-weight:bold;transform:rotate(-15deg);
      background:rgba(38,166,154,.05)
    }
    @page{size:A4;margin:0}
    html,body{height:auto}
  </style>
</head>
<body>
  <div class="certificate">
    <div class="corner corner-tl"></div>
    <div class="corner corner-tr"></div>
    <div class="corner corner-br"></div>
    <div class="corner corner-bl"></div>
    <div class="content">
      <div class="header">
        <div class="title">Certificado</div>
        <div class="subtitle">de Conclusão</div>
      </div>
      <div class="divider"></div>
      <div class="body-text">Certificamos que</div>
      <div class="recipient-name">${escapeHtml(fullName)}</div>
      <div class="achievement">
        Concluiu com êxito o curso de <strong>${escapeHtml(courseTitle)}</strong>,
        demonstrando excelente desempenho e dedicação durante o período de aprendizado.
      </div>
      <div class="divider"></div>
      <div class="footer">
        <div class="signature-block">
          <div class="signature-line"></div>
          <div class="signature-name">João Pedro Costa</div>
          <div class="signature-title">Diretor Acadêmico</div>
        </div>
        <div class="signature-block">
          <div class="signature-line"></div>
          <div class="signature-name">Ana Carolina Lima</div>
          <div class="signature-title">Coordenadora do Curso</div>
        </div>
      </div>
      <div class="date">${escapeHtml(issuedStr)}</div>
    </div>
    <div class="seal">SELO<br>OFICIAL</div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isAdminRequest(req: Request): boolean {
  if (process.env.ADMIN_OPEN === "1") return true;

  const email = req.auth?.email?.toLowerCase() || "";
  if (!email) return false;

  const csv = (process.env.ADMIN_EMAILS || "").toLowerCase();
  const allow = csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow.includes(email);
}

async function renderCertificatePdf(row: Row, res: Response): Promise<void> {
  const fullName = row.full_name || "Aluno";
  const courseTitle = row.course_title || "Curso";
  const issuedAt = new Date(row.issued_at);
  const city = "Florianópolis"; // sem ENVs, fixo

  const html = buildHtml({ fullName, courseTitle, city, issuedAt });

  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.waitForSelector("#certificate, #cert-root, body", {
    visible: true,
    timeout: 10_000,
  });
  await page.evaluate(async () => {
    if ((document as any).fonts?.ready) {
      await (document as any).fonts.ready;
    }
  });
  await page.emulateMediaType("print");
  await page.addStyleTag({
    content: `
      :root{ color-scheme: light; }
      *{ -webkit-print-color-adjust:exact; print-color-adjust:exact }
      html,body{ margin:0; padding:0; background:#fff !important }
      @page{ size:210mm 297mm; margin:0 }
      @media print{
        html,body{ height:297mm }
        body{ display:block !important; min-height:auto !important; }
        .certificate { width:190mm !important; height:277mm !important; margin:10mm auto !important; box-shadow:none !important; }
      }
    `,
  });
  await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 }); // A4 @96dpi
  const pdf = await page.pdf({
    width: "210mm",
    height: "297mm",
    printBackground: true,
    preferCSSPageSize: false,
    pageRanges: "1",
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await browser.close();

  const serial = row.serial || "cert";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="cert-${serial}.pdf"`);
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
  res.status(200).send(pdf);
}

router.get("/:userId/:courseId.pdf", async (req: Request, res: Response) => {
  const userId = String(req.params.userId || "").trim();
  const courseId = String(req.params.courseId || "").trim();
  const rawHash = String(req.query.h || "").trim();
  const h = rawHash.toLowerCase();
  const dbg = String(req.query.dbg || req.query.debug || "") === "1";

  // Bloqueio antecipado: sem hash exige bearer de dono ou admin.
  if (!rawHash) {
    const auth = (req as any).auth as MaybeAuth | undefined;
    const isOwner = auth?.userId === userId;
    const isAdmin = Boolean(auth?.isAdmin) || isAdminRequest(req);
    if (!(isOwner || isAdmin)) {
      const payload = { error: "no_token", reason: "missing_hash_and_no_bearer" };
      return dbg ? res.status(401).json(payload) : res.status(401).send("no_token");
    }
  }

  if (!isUuid(userId) || !isUuid(courseId)) {
    return res.status(400).json({ error: "bad_request" });
  }

  const hasBearer = Boolean((req.headers.authorization || "").startsWith("Bearer "));

  try {
    let allowed = false;
    let reason: string = "none";

    const { rows } = await pool.query(
      `select serial_hash
         from certificate_issues
        where user_id = $1 and course_id = $2
        limit 1`,
      [userId, courseId]
    );
    const savedHash = rows[0]?.serial_hash?.toLowerCase() || null;

    if (h && savedHash && savedHash === h) {
      allowed = true;
      reason = "by_hash";
    }

    if (!allowed && hasBearer) {
      const auth = (req as any).auth as MaybeAuth | undefined;
      const uid = auth?.userId;
      // manter compat com overrides por ENV
      const adminByEnv = isAdminRequest(req); // helper já definido acima
      const isAdmin = Boolean(auth?.isAdmin) || adminByEnv;
      if (isAdmin || uid === userId) {
        allowed = true;
        reason = isAdmin ? (adminByEnv ? "by_admin_env" : "by_admin") : "by_self";
      } else {
        reason = "bearer_not_authorized";
      }
    }

    if (!allowed) {
      const payload = {
        error: "unauthorized",
        reason,
        hasBearer,
        hasHash: Boolean(h),
        sawHash: h ? "yes" : "no",
      };
      return res.status(401).json(dbg ? payload : { error: "no_token" });
    }

    const q = await pool.query<Row>(
      `
      select
        ci.user_id,
        ci.course_id,
        ci.full_name,
        ci.issued_at,
        ci.serial,
        coalesce(c.title, '') as course_title
      from certificate_issues ci
      left join courses c on c.id = ci.course_id
      where ci.user_id = $1 and ci.course_id = $2
      limit 1
      `,
      [userId, courseId]
    );
    const row = q.rows[0];
    if (!row) return res.status(404).send("not_found");

    await renderCertificatePdf(row, res);
  } catch (e) {
    console.error("[certificates-pdf] render error", e);
    return res.status(500).send("render_failed");
  }
});

router.get("/:serial", async (req: Request, res: Response) => {
  const serial = String(req.params.serial || "").trim();
  if (!serial) return res.status(400).send("serial_required");

  const dbg = String(req.query.dbg || req.query.debug || "") === "1";
  const hasBearer = Boolean((req.headers.authorization || "").startsWith("Bearer "));
  const auth = (req as any).auth as MaybeAuth | undefined;
  const adminByEnv = isAdminRequest(req);
  const isAdmin = Boolean(auth?.isAdmin) || adminByEnv;

  if (!isAdmin) {
    const payload = {
      error: "unauthorized",
      reason: "admin_only",
      hasBearer,
    };
    return res.status(401).json(dbg ? payload : { error: "no_token" });
  }

  try {
    const q = await pool.query<Row>(
      `
      select
        ci.user_id,
        ci.course_id,
        ci.full_name,
        ci.issued_at,
        ci.serial,
        coalesce(c.title, '') as course_title
      from certificate_issues ci
      left join courses c on c.id = ci.course_id
      where ci.serial = $1
      limit 1
      `,
      [serial]
    );
    const row = q.rows[0];
    if (!row) return res.status(404).send("not_found");
    await renderCertificatePdf(row, res);
  } catch (e) {
    console.error("[certificates-pdf] render error", e);
    return res.status(500).send("render_failed");
  }
});

export default router;
