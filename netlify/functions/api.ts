// netlify/functions/api.ts
import serverless from "serverless-http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const compiledApp = require("../../dist/server/app.js");
const app = compiledApp.default ?? compiledApp;

// inclui PNG e PDF como tipos binários
export const handler = serverless(app, {
  binary: [
    "application/pdf",
    "font/woff2",
    "image/avif",
    "image/jpeg",
    "image/png",
    "image/webp",
  ],
});
