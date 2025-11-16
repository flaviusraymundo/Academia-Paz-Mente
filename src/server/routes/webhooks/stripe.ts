// src/server/routes/webhooks/stripe.ts
import express, { Request, Response } from "express";
import Stripe from "stripe";
import { pool, withTx } from "../../lib/db";
import { beginIdempotent, finishIdempotent } from "../../lib/idempotency";
import { ulid } from "ulid";

// Router com raw body apenas aqui
const router = express.Router();
router.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
      apiVersion: "2024-06-20",
    });
    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).send("missing signature");
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET as string
      );
    } catch (err) {
      return res.status(400).send(`invalid signature`);
    }

    // Inbox: garante unicidade por provider_event_id
    try {
      await pool.query(
        `insert into webhook_inbox(provider, provider_event_id, payload)
         values ('stripe',$1,$2)
         on conflict (provider, provider_event_id) do nothing`,
        [event.id, JSON.parse(req.body.toString("utf8"))]
      );
    } catch {
      // segue; se já existe, idempotência cobre
    }

    // Idempotência por event.id
    const scope = "webhook:stripe";
    const outcome = await withTx(async (client) => {
      const mode = await beginIdempotent(client, event.id, scope);
      if (mode === "exists") return "duplicate";

      // Normalização e efeitos
      const occurredAt = new Date((event.created || Math.floor(Date.now() / 1000)) * 1000);
      const eventId = ulid();

      // Exemplo de eventos importantes
      switch (event.type) {
        case "payment_intent.succeeded":
        case "checkout.session.completed":
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          await client.query(
            `insert into event_log(event_id, topic, occurred_at, source, payload)
             values ($1,$2,$3,'stripe',$4)`,
            [eventId, event.type, occurredAt, event.data.object as any]
          );
          // TODO: atualizar purchases/memberships/entitlements aqui
          break;
        default:
          await client.query(
            `insert into event_log(event_id, topic, occurred_at, source, payload)
             values ($1,$2,$3,'stripe',$4)`,
            [eventId, event.type, occurredAt, event.data.object as any]
          );
      }

      await finishIdempotent(client, event.id, "succeeded");
      return "ok";
    });

    if (outcome === "duplicate") return res.status(200).send("ok");
    return res.status(200).send("ok");
  }
);

export default router;
