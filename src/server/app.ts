// src/server/app.ts
import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { json } from "express";
import { pool } from "./lib/db.js";

import videoRouter from "./routes/video.js";
import catalogRouter from "./routes/catalog.js";
import checkoutRouter from "./routes/checkout.js";
import quizzesRouter from "./routes/quizzes.js";
import progressRouter from "./routes/progress.js";
import authRouter from "./routes/auth.js";
import certificatesPdf from "./routes/certificates-pdf.js";
import { certificatesPublic, certificatesPrivate } from "./routes/certificates.js";
import eventsRouter from "./routes/events.js";
import adminRouter from "./routes/admin.js";
import adminAnalyticsRouter from "./routes/admin-analytics.js";
import adminAnalyticsExportRouter from "./routes/admin-analytics-export.js";
import { requireAuth } from "./middleware/auth.js";
import { requireAdmin } from "./middleware/admin.js";
import entitlementsRouter from "./routes/entitlements.js";
import { attachAuthIfPresent } from "./middleware/auth-optional.js";
import { requireRole } from "./middleware/roles.js";

const app = express();
app.set("trust proxy", true); // faz req.protocol/hostname respeitarem x-forwarded-*

app.use(helmet());
app.use(morgan("combined"));
app.use(json({ limit: "1mb" }));

const allowedOrigins = [
  /^https:\/\/lifeflourishconsulting\.com$/,
  /^https:\/\/www\.lifeflourishconsulting\.com$/,
  /^https:\/\/lifeflourishconsulting\.netlify\.app$/,
  /^https:\/\/staging--profound-seahorse-147612\.netlify\.app$/,
  /^https:\/\/deploy-preview-\d+--profound-seahorse-147612\.netlify\.app$/,
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
// import studioRouter from "./routes/studio.js";
// app.use("/api/studio", requireAuth, requireRole('instructor','admin'), studioRouter);

export default app;
