// src/server/index.ts
import "dotenv/config";
import path from "node:path";
import next from "next";
import type { RequestHandler } from "express";

import app from "./app.js";

const port = Number(process.env.PORT || 3000);
const dev = process.env.NODE_ENV !== "production";

const nextApp = next({
  dev,
  dir: path.join(process.cwd(), "web"),
});
const handle = nextApp.getRequestHandler();

async function bootstrap() {
  await nextApp.prepare();

  const nextHandler: RequestHandler = (req, res, nextFn) => {
    if (req.path.startsWith("/api")) return nextFn();
    return handle(req, res);
  };

  app.use(nextHandler);

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API + Next listening on :${port}`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to bootstrap server", err);
  process.exit(1);
});
