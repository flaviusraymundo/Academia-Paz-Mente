// src/server/index.ts
import "dotenv/config";
import express, { Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { json } from "express";
import { pool } from "./lib/db.js";
import stripeWebhookRouter from "./routes/webhooks/stripe.js";
import videoRouter from "./routes/video.js";
import catalogRouter from "./routes/catalog.js";
import checkoutRouter from "./routes/checkout.js";
import quizzesRouter from "./routes/quizzes.js";
import progressRouter from "./routes/progress.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(morgan("combined"));

// JSON global, exceto no webhook Stripe
app.use(json({ limit: "1mb" }));

app.get("/health", async (_req: Request, res: Response) => {
  await pool.query("select 1");
  res.json({ ok: true });
});

// Webhook Stripe com raw
app.use("/webhooks/stripe", stripeWebhookRouter);

// Rotas públicas
app.use("/catalog", catalogRouter);

// Rotas autenticadas
app.use("/checkout", requireAuth, checkoutRouter);
app.use("/video", requireAuth, videoRouter);
app.use("/", requireAuth, progressRouter);      // /me/progress
app.use("/quizzes", requireAuth, quizzesRouter); // /quizzes/:quizId/submit

const port = process.env.PORT || 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port}`);
});
