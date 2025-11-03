// src/server/index.ts
import "dotenv/config";
import express, { Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { json } from "express";
import { pool } from "./lib/db.js";
import stripeWebhookRouter from "./routes/webhooks/stripe.js";

const app = express();

// Segurança básica e logs
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(morgan("combined"));

// Body parsers padrão (não para o webhook Stripe)
app.use(json({ limit: "1mb" }));

// Healthcheck
app.get("/health", async (_req: Request, res: Response) => {
  await pool.query("select 1");
  res.json({ ok: true });
});

// Webhook Stripe precisa de raw body. Router dedicado cuida do parser.
app.use("/webhooks/stripe", stripeWebhookRouter);

// TODO: /auth/magic-link, /catalog, /checkout/session, etc.

const port = process.env.PORT || 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port}`);
});
