// src/server/routes/certificates-pdf.ts
import fs from "fs";
import path from "path";
import { Buffer } from "buffer";
import { Router, Request, Response } from "express";
import { pool } from "../lib/db";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import QRCode from "qrcode";
import { isUuid } from "../utils/ids";

const router = Router();

function relaxInlinePdfCSP(res: Response) {
  // Evita tela em branco do viewer do Chrome quando navega direto no PDF
  try {
    res.removeHeader("Content-Security-Policy");
  } catch {}
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'self' data: blob:; frame-ancestors 'self';"
  );
}

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
async function loadAssetDataUrl(
  req: Request,
  relPath: string,
  mime: string
): Promise<string | null> {
  const fsPath = findFile(`public/${relPath.replace(/^\/+/, "")}`);
  if (fsPath) {
    try {
      const buf = fs.readFileSync(fsPath);
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch (error) {
      console.error(`[cert-pdf] Erro ao ler ${relPath} do filesystem:`, error);
    }
  }

  try {
    const url = `${publicOrigin(req)}/${relPath.replace(/^\/+/, "")}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const arr = await response.arrayBuffer();
    return `data:${mime};base64,${Buffer.from(arr).toString("base64")}`;
  } catch (error) {
    console.error(`[cert-pdf] Erro ao buscar ${relPath} via HTTP:`, error);
    return null;
  }
}

async function loadLogoDataUrl(req: Request): Promise<string | null> {
  return loadAssetDataUrl(req, "/images/logo.png", "image/png");
}

async function loadSealDataUrl(req: Request): Promise<string | null> {
  return loadAssetDataUrl(req, "/images/selo.png", "image/png");
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

function joinPaths(left: string, right: string): string {
  const leftClean = left.replace(/\/+$/, "");
  const rightClean = right.replace(/^\/+/, "");
  const combined = `${leftClean}/${rightClean}`;
  return combined.startsWith("/") ? combined : `/${combined}`;
}

function buildVerifyUrl(serial: string): string {
  if (!serial) return "";

  const base = (VERIFY_BASE_URL || process.env.APP_BASE_URL || process.env.URL || "").trim();
  if (!base) return "";

  const verifyPath = "/api/certificates/verify";
  let finalBase: string;

  try {
    const parsed = new URL(base);
    const currentPath = parsed.pathname.replace(/\/+$/, "");
    if (!currentPath.toLowerCase().startsWith(verifyPath)) {
      parsed.pathname = joinPaths(currentPath, verifyPath);
    }
    finalBase = parsed.toString().replace(/\/+$/, "");
  } catch {
    const normalized = base.replace(/\/+$/, "");
    const hasVerify = normalized.toLowerCase().includes(verifyPath);
    finalBase = hasVerify ? normalized : `${normalized}${verifyPath}`;
  }

  const separator = finalBase.endsWith("/") ? "" : "/";
  return `${finalBase}${separator}${encodeURIComponent(serial)}`;
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
    sealDataUrl?: string;
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
    SEAL_DATA_URL: params.sealDataUrl || "",
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
  const sealDataUrl = await loadSealDataUrl(req);
  const verifyUrl =
    buildVerifyUrl(serial) ||
    `${publicOrigin(req)}/api/certificates/verify/${encodeURIComponent(serial)}`;
  let qrDataUrl = FALLBACK_QR_DATA_URL;
  if (verifyUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(verifyUrl, {
        errorCorrectionLevel: "M",
        margin: 0,
      });
    } catch (error) {
      console.error("[cert-pdf] Falha ao gerar QR code:", error);
    }
  }

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
    qrDataUrl,
    sealDataUrl,
  });

  console.log(`[cert-pdf] HTML montado: ${htmlDoc.length} bytes`);

  // Debug: retorna HTML puro
  if (String(req.query.fmt || "") === "html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(htmlDoc);
    return;
  }

  // Renderiza com Puppeteer
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  let browserClosed = false;
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
    // Viewport em A4 @96dpi (~210mm x 297mm) e escala 2 p/ nitidez
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    
    // Carrega HTML
    await page.setContent(htmlDoc, {
      waitUntil: "networkidle0", 
      timeout: 30000 
    });
    // Renderizar como "print" garante que @page/@media print valham
    await page.emulateMediaType("print");

    // Aguarda elemento principal e mede o retângulo visível
    try {
      await page.waitForSelector(".sheet", { visible: true, timeout: 10000 });
      const box = await page.$eval(".sheet", el => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      (page as any).__sheetBox = box;
      console.log("[cert-pdf] .sheet bbox:", box);
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

    // Debug: screenshot PNG (binário puro, sem conversões)
    if (String(req.query.shot || "") === "1") {
      console.log("[cert-pdf] Gerando screenshot PNG");

      try {
        await page.emulateMediaType("screen");
      } catch {}

      let pngBuf: Buffer;
      try {
        const sheetBox = (page as any).__sheetBox as
          | { x: number; y: number; width: number; height: number }
          | undefined;
        if (!sheetBox) {
          throw new Error("sheet box unavailable");
        }

        const clip = {
          x: Math.max(0, Math.floor(sheetBox.x)),
          y: Math.max(0, Math.floor(sheetBox.y)),
          width: Math.max(1, Math.ceil(sheetBox.width)),
          height: Math.max(1, Math.ceil(sheetBox.height)),
        };

        pngBuf = (await page.screenshot({
          type: "png",
          clip,
          omitBackground: false,
        })) as Buffer;

        if (!pngBuf || pngBuf.length === 0) {
          throw new Error("empty clipped screenshot");
        }
      } catch {
        pngBuf = (await page.screenshot({ type: "png", fullPage: true })) as Buffer;

        if (!pngBuf || pngBuf.length === 0) {
          await page.waitForTimeout(200);
          pngBuf = (await page.screenshot({
            type: "png",
            fullPage: true,
          })) as Buffer;
        }
      }

      if (browser) {
        try {
          await browser.close();
        } catch {}
        browserClosed = true;
        browser = null;
      }

      relaxInlinePdfCSP(res);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": String(pngBuf.length),
        // nunca cache público para imagens debugadas por bearer/hash
        "Cache-Control": "private, no-store",
        Vary: "Authorization, Cookie",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="cert-${serial}.png"`,
      });
      res.end(pngBuf);
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

    // Relaxa CSP apenas nesta rota (evita viewer em branco)
    relaxInlinePdfCSP(res);
    res.setHeader("Content-Type", "application/pdf");
    const wantsDownload =
      String(req.query.download || "") === "1" ||
      String(req.query.download || "").toLowerCase() === "true";
    const disp = wantsDownload ? "attachment" : "inline";
    res.setHeader("Content-Disposition", `${disp}; filename="cert-${serial}.pdf"`);
    // Evita confundir validação manual com artefatos em cache compartilhado
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Authorization, Cookie");
    res.status(200).send(pdf);
  } catch (error) {
    console.error("[cert-pdf] Erro na renderização:", error);
    throw error;
  } finally {
    if (browser && !browserClosed) {
      try {
        const isConnected =
          typeof (browser as any).isConnected === "function"
            ? (browser as any).isConnected()
            : true;
        if (isConnected) {
          await browser.close();
        }
      } catch (closeError) {
        console.warn("[cert-pdf] Falha ao fechar browser (finally):", closeError);
      } finally {
        browserClosed = true;
        browser = null;
      }
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
