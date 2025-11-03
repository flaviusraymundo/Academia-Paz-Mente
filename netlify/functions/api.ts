// netlify/functions/api.ts
import serverless from "serverless-http";
import app from "../../src/server/app.js";

export const handler = serverless(app, {
  request: (_req: any) => {
    // Nada especial aqui. Webhook Stripe será função separada para raw body.
  },
});
