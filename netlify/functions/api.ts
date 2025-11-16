// netlify/functions/api.ts
import serverless from "serverless-http";
import app from "../../src/server/app.js";

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
