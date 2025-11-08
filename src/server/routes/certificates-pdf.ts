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
  issued_at: string; // timestamptz
  serial: string;
  course_title: string | null;
};

const TEMPLATE_PATH = path.join(process.cwd(), "public", "cert-templates", "elegant-classic-brand.html");
const LOGO_PATH = path.join(process.cwd(), "public", "images", "logo.png");
const DIRECTOR_NAME = process.env.CERT_DIRECTOR_NAME || "João Pedro Costa";
const COORD_NAME = process.env.CERT_COORD_NAME || "Ana Carolina Lima";
const VERIFY_BASE_URL = process.env.CERT_VERIFY_BASE_URL || "";
const FALLBACK_QR_DATA_URL =
  process.env.CERT_QR_PLACEHOLDER_DATA_URL ||
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

let templateCache: string | null = null;
let logoDataUrlCache: string | null | undefined;

function publicOrigin(req: Request) {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (req as any).protocol ||
    "https";
  const host =
    (req.headers["x-forwarded-host"] as string) ||
    req.get("host") ||
    "localhost";
  return `${proto}://${host}`.replace(/\/+$/i, "");
}

async function loadCertTemplate(req: Request): Promise<string> {
  if (templateCache) return templateCache;

  try {
    templateCache = fs.readFileSync(TEMPLATE_PATH, "utf8");
    return templateCache;
  } catch {
    const url = `${publicOrigin(req)}/cert-templates/elegant-classic-brand.html`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`template_fetch_failed:${response.status}`);
    }
    const html = await response.text();
    templateCache = html;
    return html;
  }
}

async function loadLogoDataUrl(req: Request): Promise<string | null> {
  if (logoDataUrlCache !== undefined) {
    return logoDataUrlCache;
  }

  try {
    const buf = fs.readFileSync(LOGO_PATH);
    logoDataUrlCache = `data:image/png;base64,${buf.toString("base64")}`;
    return logoDataUrlCache;
  } catch {
    try {
      const response = await fetch(`${publicOrigin(req)}/images/logo.png`);
      if (!response.ok) {
        logoDataUrlCache = null;
        return logoDataUrlCache;
      }
      const arr = await response.arrayBuffer();
      const buf = Buffer.from(arr);
      logoDataUrlCache = `data:image/png;base64,${buf.toString("base64")}`;
      return logoDataUrlCache;
    } catch {
      logoDataUrlCache = null;
      return logoDataUrlCache;
    }
  }
}

async function inlineLogo(html: string, req: Request): Promise<string> {
  const dataUrl = await loadLogoDataUrl(req);
  if (!dataUrl) return html;

  return html
    .replace(/src=(["'])\/images\/logo\.png\1/gi, (_match, quote: string) => `src=${quote}${dataUrl}${quote}`)
    .replace(/src=\/images\/logo\.png/gi, `src="${dataUrl}"`);
}

function ensureBaseHref(html: string, origin: string): string {
  if (!origin) return html;
  if (/<base\s+[^>]*href=/i.test(html)) return html;

  const normalized = origin.endsWith("/") ? origin : `${origin}/`;
  const baseTag = `<base href="${normalized}">`;
  const headRe = /<head([^>]*)>/i;

  if (headRe.test(html)) {
    return html.replace(headRe, `<head$1>${baseTag}`);
  }

  return `<head>${baseTag}</head>${html}`;
}

function formatPtBrDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
  // Ex.: "07 de novembro de 2025"
  return parts;
}

function replacePlaceholders(template: string, replacements: Record<string, string>): string {
  let output = template;
  for (const [token, value] of Object.entries(replacements)) {
    output = output.replaceAll(`{{${token}}}`, value);
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
  if (!serial || !VERIFY_BASE_URL) return "";
  const base = VERIFY_BASE_URL.endsWith("/") ? VERIFY_BASE_URL.slice(0, -1) : VERIFY_BASE_URL;
  return `${base}/${encodeURIComponent(serial)}`;
}

function buildHtml(template: string, params: {
  fullName: string;
  courseTitle: string;
  city: string;
  issuedAt: Date;
  serial: string;
  verifyUrl: string;
  qrDataUrl: string;
  directorName?: string;
  coordinatorName?: string;
}): string {
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

async function renderCertificatePdf(row: Row, req: Request, res: Response): Promise<void> {
  const fullName = row.full_name || "Aluno";
  const courseTitle = row.course_title || "Curso";
  const issuedAt = new Date(row.issued_at);
  const city = process.env.CERT_CITY || "Florianópolis";
  const serial = row.serial || "cert";
  const verifyUrl = buildVerifyUrl(serial);
  const template = await loadCertTemplate(req);
  const origin = publicOrigin(req);
  const withLogo = await inlineLogo(template, req);
  const templateWithBase = ensureBaseHref(withLogo, origin);
  const html = buildHtml(templateWithBase, {
    fullName,
    courseTitle,
    city,
    issuedAt,
    serial,
    verifyUrl,
    qrDataUrl: FALLBACK_QR_DATA_URL,
  });

  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.waitForSelector(".sheet", {
    visible: true,
    timeout: 10_000,
  });
  await page.emulateMediaType("print");
  await page.evaluate(async () => {
    if ((document as any).fonts?.ready) {
      await (document as any).fonts.ready;
    }
  });
  const pdf = await page.pdf({
    printBackground: true,
    preferCSSPageSize: true,
    pageRanges: "1",
  });
  await browser.close();

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

    await renderCertificatePdf(row, req, res);
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
    await renderCertificatePdf(row, req, res);
  } catch (e) {
    console.error("[certificates-pdf] render error", e);
    return res.status(500).send("render_failed");
  }
});

export default router;
