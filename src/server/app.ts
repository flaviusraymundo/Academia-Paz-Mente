// src/server/app.ts
import express, { Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { json } from "express";
import { pool } from "./lib/db.js";

import videoRouter from "./routes/video.js";
import catalogRouter from "./routes/catalog.js";
import checkoutRouter from "./routes/checkout.js";
import quizzesRouter from "./routes/quizzes.js";
import progressRouter from "./routes/progress.js";
import authRouter from "./routes/auth.js";
import certificatesRouter from "./routes/certificates.js";
import eventsRouter from "./routes/events.js";
import adminRouter from "./routes/admin.js";
import { requireAuth } from "./middleware/auth.js";
import { requireAdmin } from "./middleware/admin.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(morgan("combined"));
app.use(json({ limit: "1mb" }));

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
app.use(["/checkout", "/api/checkout"], requireAuth, checkoutRouter);
app.use(["/video", "/api/video"], requireAuth, videoRouter);
app.use(["/quizzes", "/api/quizzes"], requireAuth, quizzesRouter);

// Perfil/progresso/certificados (autenticado)
app.use(["/api"], requireAuth, progressRouter);                    // escopo /api
app.use(["/certificates", "/api/certificates"], requireAuth, certificatesRouter); // /certificates/:courseId/issue

// Admin (protegido) — por último, e montado nas duas bases
app.use(["/admin", "/api/admin"], requireAuth, requireAdmin, adminRouter);

export default app;
