// src/server/routes/certificates-pdf.ts
import fs from "fs";
import path from "path";
import { Buffer } from "buffer";
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
  issued_at: string;
  serial: string;
  course_title: string | null;
};

const DIRECTOR_NAME = process.env.CERT_DIRECTOR_NAME || "João Pedro Costa";
const COORD_NAME = process.env.CERT_COORD_NAME || "Ana Carolina Lima";
const VERIFY_BASE_URL = process.env.CERT_VERIFY_BASE_URL || "";
const FALLBACK_QR_DATA_URL =
  process.env.CERT_QR_PLACEHOLDER_DATA_URL ||
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

// ============================================
// CORREÇÃO 1: Função robusta para encontrar arquivos
// ============================================
function findFile(relativePath: string): string | null {
  const possibleRoots = [
    process.cwd(),
    path.join(process.cwd(), "dist"),
    "/var/task",
    path.join(__dirname, "../.."),
    path.join(__dirname, "../../.."),
  ];

  for (const root of possibleRoots) {
    const fullPath = path.join(root, relativePath);
    if (fs.existsSync(fullPath)) {
      console.log(`[cert-pdf] Arquivo encontrado: ${fullPath}`);
      return fullPath;
    }
  }

  console.warn(`[cert-pdf] Arquivo não encontrado: ${relativePath}`);
  return null;
}

function publicOrigin(req: Request): string {
  // Prioriza variáveis de ambiente
  const envBase = (process.env.APP_BASE_URL || process.env.URL || "").trim().replace(/\/+$/, "");
  if (envBase) return envBase;

  // Fallback para headers
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "localhost";
  return `${proto}://${host}`;
}

// ============================================
// CORREÇÃO 2: Carregamento sem cache global
// ============================================
async function loadCertTemplate(req: Request): Promise<string> {
  // Tenta carregar do filesystem
  const templatePath = findFile("public/cert-templates/elegant-classic-brand.html");
  
  if (templatePath) {
    try {
      const content = fs.readFileSync(templatePath, "utf8");
      console.log(`[cert-pdf] Template carregado do filesystem: ${content.length} bytes`);
      return content;
    } catch (error) {
      console.error("[cert-pdf] Erro ao ler template do filesystem:", error);
    }
  }

  // Fallback: busca via HTTP
  console.warn("[cert-pdf] Tentando fetch do template via HTTP");
  const url = `${publicOrigin(req)}/cert-templates/elegant-classic-brand.html`;
  console.log(`[cert-pdf] Buscando template em: ${url}`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`template_fetch_failed: ${response.status} ${response.statusText}`);
  }
  
  const content = await response.text();
  console.log(`[cert-pdf] Template carregado via HTTP: ${content.length} bytes`);
  return content;
}

// ============================================
// CORREÇÃO 3: Logo inline sem cache global
// ============================================
async function loadLogoDataUrl(req: Request): Promise<string | null> {
  // Tenta carregar do filesystem
  const logoPath = findFile("public/images/logo.png");
  
  if (logoPath) {
    try {
      const buf = fs.readFileSync(logoPath);
      console.log(`[cert-pdf] Logo carregado do filesystem: ${buf.length} bytes`);
      return `data:image/png;base64,${buf.toString("base64")}`;
    } catch (error) {
      console.error("[cert-pdf] Erro ao ler logo do filesystem:", error);
    }
  }

  // Fallback: busca via HTTP
  try {
    const url = `${publicOrigin(req)}/images/logo.png`;
    console.log(`[cert-pdf] Buscando logo em: ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[cert-pdf] Logo não encontrado via HTTP: ${response.status}`);
      return null;
    }
    
    const arr = await response.arrayBuffer();
    const buf = Buffer.from(arr);
    console.log(`[cert-pdf] Logo carregado via HTTP: ${buf.length} bytes`);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch (error) {
    console.error("[cert-pdf] Erro ao buscar logo via HTTP:", error);
    return null;
  }
}

async function inlineLogo(html: string, req: Request): Promise<string> {
  const dataUrl = await loadLogoDataUrl(req);
  
  if (!dataUrl) {
    console.warn("[cert-pdf] Logo não disponível, usando placeholder ou removendo");
    // Remove a tag img do logo para evitar erro 404
    return html.replace(/<img[^>]*src=(["'])\/images\/logo\.png\1[^>]*>/gi, "");
  }

  // Substitui todas as referências ao logo
  return html
    .replace(/src=(["'])\/images\/logo\.png\1/gi, `src="${dataUrl}"`)
    .replace(/src=\/images\/logo\.png/gi, `src="${dataUrl}"`);
}

function formatPtBrDate(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}

function replacePlaceholders(template: string, replacements: Record<string, string>): string {
  let output = template;
  for (const [token, value] of Object.entries(replacements)) {
    const regex = new RegExp(`\\{\\{${token}\\}\\}`, "g");
    output = output.replace(regex, value);
  }
  return output;
}

function sanitizeUrl(url: string): string {
  if (!url) return "";
  try {
    return new URL(url).toString();
  } catch {
    return "";
  }
}

function buildVerifyUrl(serial: string): string {
  if (!serial) return "";
  
  const base = VERIFY_BASE_URL || process.env.APP_BASE_URL || process.env.URL || "";
  if (!base) return "";
  
  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${cleanBase}/api/certificates/verify/${encodeURIComponent(serial)}`;
}

function buildHtml(
  template: string,
  params: {
    fullName: string;
    courseTitle: string;
    city: string;
    issuedAt: Date;
    serial: string;
    verifyUrl: string;
    qrDataUrl: string;
    directorName?: string;
    coordinatorName?: string;
  }
): string {
  const issuedDateStr = formatPtBrDate(params.issuedAt);

  const replacements: Record<string, string> = {
    SERIAL: escapeHtml(params.serial),
    FULL_NAME: escapeHtml(params.fullName),
    COURSE_TITLE: escapeHtml(params.courseTitle),
    DIRECTOR_NAME: escapeHtml(params.directorName || DIRECTOR_NAME),
    COORD_NAME: escapeHtml(params.coordinatorName || COORD_NAME),
    ISSUED_DATE_BR: escapeHtml(issuedDateStr),
    QR_DATA_URL: params.qrDataUrl || FALLBACK_QR_DATA_URL,
    VERIFY_URL: escapeHtml(sanitizeUrl(params.verifyUrl)),
  };

  let html = template.replace("Florianópolis,", `${escapeHtml(params.city)},`);
  html = replacePlaceholders(html, replacements);

  return html;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

async function renderCertificatePdf(row: Row, req: Request, res: Response): Promise<void> {
  const fullName = row.full_name || "Aluno";
  const courseTitle = row.course_title || "Curso";
  const issuedAt = new Date(row.issued_at);
  const city = process.env.CERT_CITY || "Florianópolis";
  const serial = row.serial || "cert";
  const verifyUrl = buildVerifyUrl(serial);

  console.log(`[cert-pdf] Iniciando renderização: serial=${serial}, user=${row.user_id}`);

  // Carrega template
  let template: string;
  try {
    template = await loadCertTemplate(req);
  } catch (error) {
    console.error("[cert-pdf] Erro ao carregar template:", error);
    throw new Error("Falha ao carregar template");
  }

  // Faz inline do logo
  const withLogo = await inlineLogo(template, req);
  
  // Monta HTML final
  const htmlDoc = buildHtml(withLogo, {
    fullName,
    courseTitle,
    city,
    issuedAt,
    serial,
    verifyUrl,
    qrDataUrl: FALLBACK_QR_DATA_URL,
  });

  console.log(`[cert-pdf] HTML montado: ${htmlDoc.length} bytes`);

  // Debug: retorna HTML puro
  if (String(req.query.fmt || "") === "html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(htmlDoc);
    return;
  }

  // Renderiza com Puppeteer
  let browser: import("puppeteer-core").Browser | null = null;
  try {
    const executablePath = await chromium.executablePath();
    console.log(`[cert-pdf] Chromium path: ${executablePath}`);

    browser = await puppeteer.launch({
      args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    
    // Carrega HTML
    await page.setContent(htmlDoc, { 
      waitUntil: "networkidle0", 
      timeout: 30000 
    });

    // Aguarda elemento principal
    try {
      await page.waitForSelector(".sheet", { visible: true, timeout: 10000 });
      console.log("[cert-pdf] Elemento .sheet encontrado");
    } catch (error) {
      console.warn("[cert-pdf] Timeout aguardando .sheet, continuando...");
    }

    // Aguarda fontes
    await page.evaluate(async () => {
      try {
        if ((document as any).fonts?.ready) {
          await (document as any).fonts.ready;
        }
      } catch (_) {}
    });

    await page.emulateMediaType("print");

    // Aplica CSS de impressão forçado
    await page.addStyleTag({
      content: `
        @page { 
          size: 210mm 297mm; 
          margin: 0; 
        }
        
        html, body {
          width: 210mm !important;
          height: 297mm !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
        }
        
        body { 
          display: block !important; 
          background: #fff !important; 
          box-shadow: none !important;
        }
        
        .sheet { 
          width: 210mm !important; 
          height: 297mm !important; 
          min-height: 297mm !important;
          max-height: 297mm !important;
          margin: 0 !important; 
          padding: 20mm 20mm 25mm 20mm !important;
          box-shadow: none !important; 
          page-break-inside: avoid !important; 
          page-break-after: avoid !important;
          border-radius: 0 !important;
          overflow: hidden !important;
          position: relative !important;
        }
        
        * { 
          -webkit-print-color-adjust: exact !important; 
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
      `,
    });

    // Debug: screenshot PNG
    if (String(req.query.shot || "") === "1") {
      console.log("[cert-pdf] Gerando screenshot PNG");
      const png = await page.screenshot({ fullPage: true, type: "png" });
      await browser!.close();
      browser = null;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Disposition", `inline; filename="cert-${serial}.png"`);
      res.end(png);
      return;
    }

    // Gera PDF
    console.log("[cert-pdf] Gerando PDF...");
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      width: "210mm",
      height: "297mm",
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      pageRanges: "1",
    });

    console.log(`[cert-pdf] PDF gerado com sucesso: ${pdf.length} bytes`);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="cert-${serial}.pdf"`);
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    res.status(200).send(pdf);
  } catch (error) {
    console.error("[cert-pdf] Erro na renderização:", error);
    throw error;
  } finally {
    if (browser && browser.isConnected()) {
      await browser.close();
      console.log("[cert-pdf] Browser fechado");
    }
  }
}

router.get("/:userId/:courseId.pdf", async (req: Request, res: Response) => {
  const userId = String(req.params.userId || "").trim();
  const courseId = String(req.params.courseId || "").trim();
  const rawHash = String(req.query.h || "").trim();
  const h = rawHash.toLowerCase();
  const dbg = String(req.query.dbg || req.query.debug || "") === "1";

  console.log(`[cert-pdf] GET /${userId}/${courseId}.pdf?h=${h ? "***" : "none"}`);

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
      const adminByEnv = isAdminRequest(req);
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

    await renderCertificatePdf(row, req, res);
  } catch (e) {
    console.error("[certificates-pdf] render error", e);
    return res.status(500).json({ 
      error: "render_failed", 
      message: dbg ? String(e) : undefined 
    });
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
    await renderCertificatePdf(row, req, res);
  } catch (e) {
    console.error("[certificates-pdf] render error", e);
    return res.status(500).json({ 
      error: "render_failed",
      message: dbg ? String(e) : undefined
    });
  }
});

export default router;
