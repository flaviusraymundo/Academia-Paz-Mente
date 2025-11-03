// netlify/functions/stripe-webhook.ts
import Stripe from "stripe";
import { pool } from "../../src/server/lib/db.js";
import { beginIdempotent, finishIdempotent } from "../../src/server/lib/idempotency.js";
import { ulid } from "ulid";

const DEV_FAKE = process.env.DEV_FAKE === "1";

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "method_not_allowed" };
  }

  if (DEV_FAKE) {
    // Modo fake: registra evento mínimo e retorna OK
    try {
      await pool.query(
        `insert into event_log(event_id, topic, occurred_at, source, payload)
         values ($1,'dev.stripe', now(),'app', $2)`,
        [ulid(), { note: "DEV_FAKE stripe webhook" }]
      );
    } catch {}
    return { statusCode: 200, body: "ok" };
  }

  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  if (!sig) return { statusCode: 400, body: "missing signature" };

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
    apiVersion: "2024-06-20",
  });
  let evt: Stripe.Event;
  try {
    // Netlify entrega body cru como string
    evt = stripe.webhooks.constructEvent(
      Buffer.from(event.body || "", "utf8"),
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch {
    return { statusCode: 400, body: "invalid signature" };
  }

  // Inbox e idempotência
  const client = await pool.connect();
  try {
    await client.query(
      `insert into webhook_inbox(provider, provider_event_id, payload)
       values ('stripe',$1,$2)
       on conflict (provider, provider_event_id) do nothing`,
      [evt.id, JSON.parse(event.body)]
    );

    await client.query("begin");
    const mode = await beginIdempotent(client, evt.id, "webhook:stripe");
    if (mode === "exists") {
      await client.query("rollback");
      return { statusCode: 200, body: "ok" };
    }

    const eventId = ulid();
    await client.query(
      `insert into event_log(event_id, topic, occurred_at, source, payload)
       values ($1,$2, to_timestamp($3), 'stripe', $4)`,
      [eventId, evt.type, evt.created || Math.floor(Date.now() / 1000), evt.data.object as any]
    );

    // TODO: atualizar purchases/memberships/entitlements aqui

    await finishIdempotent(client, evt.id, "succeeded");
    await client.query("commit");
    return { statusCode: 200, body: "ok" };
  } catch (e) {
    await client.query("rollback");
    return { statusCode: 500, body: "error" };
  } finally {
    client.release();
  }
};
