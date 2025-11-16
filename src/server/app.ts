// src/server/app.ts
import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { json } from "express";
import fs from "node:fs";
import path from "node:path";
import next from "next";
import { pool } from "./lib/db";

import videoRouter from "./routes/video";
import catalogRouter from "./routes/catalog";
import checkoutRouter from "./routes/checkout";
import quizzesRouter from "./routes/quizzes";
import progressRouter from "./routes/progress";
import authRouter from "./routes/auth";
import certificatesPdf from "./routes/certificates-pdf";
import { certificatesPublic, certificatesPrivate } from "./routes/certificates";
import eventsRouter from "./routes/events";
import adminRouter from "./routes/admin";
import adminAnalyticsRouter from "./routes/admin-analytics";
import adminAnalyticsExportRouter from "./routes/admin-analytics-export";
import { requireAuth } from "./middleware/auth";
import { requireAdmin } from "./middleware/admin";
import entitlementsRouter from "./routes/entitlements";
import { attachAuthIfPresent } from "./middleware/auth-optional";
import { requireRole } from "./middleware/roles";

const app = express();
app.set("trust proxy", true); // faz req.protocol/hostname respeitarem x-forwarded-*

const nodeEnv = process.env.NODE_ENV ?? "production";
if (!process.env.NODE_ENV) {
  Reflect.set(process.env, "NODE_ENV", nodeEnv);
}
const isDev = nodeEnv !== "production";
function resolveNextDir({ allowMissingBuild = false } = {}) {
  const configured = process.env.NEXT_DIR;
  const candidates = [
    configured && path.resolve(configured),
    path.join(process.cwd(), "web"),
    path.join(__dirname, "..", "..", "web"),
    path.join(process.cwd(), "..", "web"),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (!dir) continue;
    if (!fs.existsSync(dir)) continue;
    if (allowMissingBuild) return dir;
    const buildDir = path.join(dir, ".next");
    if (fs.existsSync(buildDir)) return dir;
  }

  const tried = candidates.map((dir) => `"${dir}"`).join(", ");
  const reason = allowMissingBuild ? "directory" : ".next build";
  throw new Error(`Next ${reason} not found. Checked: ${tried}`);
}

const nextDir = resolveNextDir({ allowMissingBuild: isDev });
const nextServer = next({ dev: isDev, dir: nextDir });
const nextHandlerPromise = nextServer.prepare().then(() => nextServer.getRequestHandler());
const shouldBypassNext = (pathname: string) => pathname.startsWith("/api") || pathname.startsWith("/.netlify/");

app.use(helmet());
app.use(morgan("combined"));
app.use(json({ limit: "1mb" }));

const allowedOrigins = [
  /^https:\/\/lifeflourishconsulting\.com$/,
  /^https:\/\/www\.lifeflourishconsulting\.com$/,
  /^https:\/\/lifeflourishconsulting\.netlify\.app$/,
  /^https:\/\/staging--lifeflourishconsulting\.netlify\.app$/,
  /^https:\/\/deploy-preview-\d+--lifeflourishconsulting\.netlify\.app$/,
];

const allowOrigin = (origin?: string) => {
  if (!origin) return "";
  const ok = allowedOrigins.some((pattern) => pattern.test(origin));
  return ok ? origin : "";
};

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = allowOrigin(req.headers.origin as string | undefined);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Health (público)
app.get(["/health", "/api/health"], async (_req: Request, res: Response) => {
  await pool.query("select 1");
  res.json({ ok: true });
});

// Auth público
app.use(["/", "/api"], authRouter);

// Público
app.use(["/catalog", "/api/catalog"], catalogRouter);

// Tracking público
app.use(["/events", "/api/events"], eventsRouter);

// Aluno (autenticado)
app.use("/api/checkout", requireAuth, checkoutRouter);
app.use("/api/video", requireAuth, videoRouter);
app.use("/api/quizzes", requireAuth, quizzesRouter);

// Certificados
app.use("/api/certificates/verify", certificatesPublic);
app.use("/api/certificates", attachAuthIfPresent, certificatesPdf);

// Demais endpoints públicos/abertos
app.use("/api/entitlements", entitlementsRouter);

// Rotas privadas sob /api
app.use("/api", requireAuth, progressRouter); // /api/me/*
app.use("/api/certificates", requireAuth, certificatesPrivate);

// Admin Analytics (protegido)
app.use("/api/admin/analytics", requireAuth, requireAdmin, adminAnalyticsRouter);
app.use("/api/admin/analytics", requireAuth, requireAdmin, adminAnalyticsExportRouter);

// Admin (protegido) — por último
app.use("/api/admin", requireAuth, requireAdmin, adminRouter);

// Exemplo futuro (Studio para instrutores):
// import studioRouter from "./routes/studio";
// app.use("/api/studio", requireAuth, requireRole('instructor','admin'), studioRouter);

app.all("*", (req: Request, res: Response, nextHandler: NextFunction) => {
  if (shouldBypassNext(req.path || "/")) return nextHandler();
  nextHandlerPromise
    .then((handler) => handler(req, res))
    .catch((err) => nextHandler(err));
});

export default app;
