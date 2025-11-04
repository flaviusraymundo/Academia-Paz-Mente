// src/server/app.ts
import express, { Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { json } from "express";
import { pool } from "./lib/db.js";
//import stripeWebhookRouter from "./routes/webhooks/stripe.js"; // não será usado em Netlify, mas mantém compat local
import videoRouter from "./routes/video.js";
import catalogRouter from "./routes/catalog.js";
import checkoutRouter from "./routes/checkout.js";
import quizzesRouter from "./routes/quizzes.js";
import progressRouter from "./routes/progress.js";
import authRouter from "./routes/auth.js";
import certificatesRouter from "./routes/certificates.js";
import { requireAuth } from "./middleware/auth.js";
import eventsRouter from "./routes/events.js";
import adminRouter from "./routes/admin.js";
import { requireAuth } from "./middleware/auth.js";
import { requireAdmin } from "./middleware/admin.js";

// ...

// Admin (protegido)
// funciona tanto via /api/admin (redirect da Function) quanto /admin (exec local/dev)
app.use(["/admin", "/api/admin"], requireAuth, requireAdmin, adminRouter);


const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(morgan("combined"));
app.use(json({ limit: "1mb" }));

app.get(["/health", "/api/health"], async (_req: Request, res: Response) => {
  await pool.query("select 1");
  res.json({ ok: true });
});

// Webhook Stripe: em Netlify será função dedicada; aqui fica ativo só para dev local
//app.use("/webhooks/stripe", stripeWebhookRouter);

// Auth público
app.use(["/", "/api"], authRouter);

// Público
app.use(["/catalog", "/api/catalog"], catalogRouter);

// Tracking público (respeita TRACK_PUBLIC=1 para aceitar sem JWT)
app.use(["/events", "/api/events"], eventsRouter);

// Autenticado
app.use(["/checkout", "/api/checkout"], requireAuth, checkoutRouter);
app.use(["/video", "/api/video"], requireAuth, videoRouter);
app.use(["/", "/api"], requireAuth, progressRouter);       // /me/progress
app.use(["/", "/api"], requireAuth, certificatesRouter);   // /certificates/:courseId/issue
app.use(["/quizzes", "/api/quizzes"], requireAuth, quizzesRouter);

export default app;
