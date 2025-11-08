// src/server/app.ts
import express, { Request, Response } from "express";
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
import { requireAuth } from "./middleware/auth.js";
import { requireAdmin } from "./middleware/admin.js";
import entitlementsRouter from "./routes/entitlements.js";
import { attachAuthIfPresent } from "./middleware/auth-optional.js";

const app = express();
app.set("trust proxy", true); // faz req.protocol/hostname respeitarem x-forwarded-*

app.use(helmet());
app.use(morgan("combined"));
app.use(json({ limit: "1mb" }));

// CORS consistente para toda a API
app.use((req, res, next) => {
  const origin = (req.headers.origin as string | undefined) ?? "*";
  res.header("Access-Control-Allow-Origin", origin);
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }
  next();
});

// Health (público)
app.get(["/health", "/api/health"], async (_req: Request, res: Response) => {
  await pool.query("select 1");
  res.json({ ok: true });
});

// Auth público (ex.: /login, /logout, /me public etc.)
// Montado em "/" e "/api" para funcionar local e via redirect da Function
app.use(["/", "/api"], authRouter);

// Público
app.use(["/catalog", "/api/catalog"], catalogRouter);

// Tracking público (se TRACK_PUBLIC=1, aceita sem JWT)
app.use(["/events", "/api/events"], eventsRouter);

// Aluno (autenticado)
app.use("/api/checkout", requireAuth, checkoutRouter);
app.use("/api/video", requireAuth, videoRouter);
app.use("/api/quizzes", requireAuth, quizzesRouter);

// Certificados:
// - /verify é totalmente público
// - /certificates aceita hash OU bearer (attachAuthIfPresent popula req.auth se houver)
app.use("/api/certificates/verify", certificatesPublic);
app.use("/api/certificates", attachAuthIfPresent, certificatesPdf);

// Alias legado para clientes que antes usavam /api/certificates-pdf/:serial
app.use("/api/certificates-pdf", attachAuthIfPresent, certificatesPdf);

// Demais endpoints públicos/abertos (se houver)
app.use("/api/entitlements", entitlementsRouter);

// Rotas privadas sob /api (guard)
app.use("/api", requireAuth, progressRouter); // /api/me/*
app.use("/api/certificates", requireAuth, certificatesPrivate);

// Admin (protegido) — por último
app.use("/api/admin", requireAuth, requireAdmin, adminRouter);

export default app;
