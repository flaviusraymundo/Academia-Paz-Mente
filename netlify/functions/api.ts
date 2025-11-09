// netlify/functions/api.ts
import serverless from "serverless-http";
import app from "../../src/server/app";

// inclui PNG e PDF como tipos binários
export const handler = serverless(app, {
  binary: ["image/png", "application/pdf"],
});
