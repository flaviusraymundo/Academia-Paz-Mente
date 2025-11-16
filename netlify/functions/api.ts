// netlify/functions/api.ts
import type { Handler } from "@netlify/functions";
import serverless from "serverless-http";

const binaryTypes = [
  "application/pdf",
  "font/woff2",
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
];

let cachedHandler: ReturnType<typeof serverless> | null = null;

async function getServer() {
  const compiledApp = await import("../../dist/server/app.js");
  return compiledApp.default ?? compiledApp;
}

async function getHandler() {
  if (!cachedHandler) {
    const app = await getServer();
    cachedHandler = serverless(app, { binary: binaryTypes });
  }
  return cachedHandler;
}

export const handler: Handler = async (event, context) => {
  const httpHandler = await getHandler();
  return httpHandler(event, context);
};
