// netlify/functions/api.ts
import serverless from "serverless-http";
import app from "../../src/server/app.ts";

export const handler = serverless(app);
