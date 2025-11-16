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

type ExpressApp = Parameters<typeof serverless>[0];

function unwrapModule<T>(mod: T): T {
  let current: any = mod;
  while (current?.default && current.default !== current) {
    current = current.default;
  }
  return current;
}

async function getServer(): Promise<ExpressApp> {
  const compiledApp = await import("../../dist/server/app.js");
  return unwrapModule(compiledApp) as ExpressApp;
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
