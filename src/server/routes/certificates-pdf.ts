// src/server/routes/certificates-pdf.ts
import { Router, Request, Response } from "express";
import { pool } from "../lib/db.js";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const router = Router();

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
  const pdf = await page.pdf({
    printBackground: true,
    format: "A4",
    margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
  });
  await browser.close();

  const serial = row.serial || "cert";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="cert-${serial}.pdf"`);
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
  res.status(200).send(pdf);
}

router.get("/:userId/:courseId.pdf", async (req: Request, res: Response) => {
  const { userId, courseId } = req.params as { userId: string; courseId: string };
  const qSerial = typeof req.query.serial === "string" ? req.query.serial : "";
  const qHash = ((): string => {
    const value = (req.query.h ?? req.query.hash) as string | undefined;
    return typeof value === "string" ? value : "";
  })();

  const authUserId = req.auth?.userId;
  let authorized = false;
  if (authUserId && authUserId === userId) authorized = true;
  if (!authorized && isAdminRequest(req)) authorized = true;

  try {
    if (!authorized) {
      if (!qSerial && !qHash) return res.status(401).json({ error: "no_token" });

      const { rows: authRows } = await pool.query(
        `select 1
           from certificate_issues
          where user_id=$1 and course_id=$2
            and ( ($3 <> '' and serial=$3) or ($4 <> '' and serial_hash=$4) )
          limit 1`,
        [userId, courseId, qSerial, qHash]
      );
      if (authRows.length === 0) return res.status(404).json({ error: "not_found" });
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
