import Stripe from "stripe";
import { pool } from "../../src/server/lib/db.ts";
import { beginIdempotent, finishIdempotent } from "../../src/server/lib/idempotency.ts";
import { ulid } from "ulid";

// Webhook separado do app Express porque precisa de raw body.
export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "method_not_allowed" };
  }

  const DEV_FAKE = process.env.DEV_FAKE === "1";
  if (DEV_FAKE) {
    try {
      await pool.query(
        "insert into event_log(event_id, topic, occurred_at, source, payload) values ($1,'dev.stripe', now(),'app', $2)",
        [ulid(), { note: "DEV_FAKE stripe webhook" }]
      );
    } catch {
      /* noop */
    }
    return { statusCode: 200, body: "ok" };
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;
  if (!stripeSecret || !webhookSecret) {
    return { statusCode: 500, body: "stripe_env_missing" };
  }

  const signature =
    event.headers["stripe-signature"] ||
    event.headers["Stripe-Signature"] ||
    event.headers["STRIPE-SIGNATURE"];
  if (!signature) return { statusCode: 400, body: "missing_signature" };

  // Netlify pode enviar o body em base64.
  const rawBody: Buffer = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : Buffer.from(event.body || "", "utf8");

  const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" });

  let evt: Stripe.Event;
  try {
    evt = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return { statusCode: 400, body: "invalid_signature" };
  }

  const client = await pool.connect();
  try {
    // Inbox (mantém payload bruto para auditoria)
    let parsedPayload: any = {};
    try {
      const str = rawBody.toString("utf8");
      parsedPayload = JSON.parse(str);
    } catch {
      parsedPayload = {};
    }
    await client.query(
      "insert into webhook_inbox(provider, provider_event_id, payload) values ('stripe',$1,$2) on conflict (provider, provider_event_id) do nothing",
      [evt.id, parsedPayload]
    );

    await client.query("begin");
    const mode = await beginIdempotent(client, evt.id, "webhook:stripe");
    if (mode === "exists") {
      await client.query("rollback");
      return { statusCode: 200, body: "ok" };
    }

    const eventId = ulid();
    const occurredUnix = (evt.created || Math.floor(Date.now() / 1000)) as number;
    await client.query(
      "insert into event_log(event_id, topic, occurred_at, source, payload) values ($1,$2,to_timestamp($3),'stripe',$4)",
      [eventId, evt.type, occurredUnix, evt.data.object as any]
    );

    switch (evt.type) {
      case "checkout.session.completed": {
        const s = evt.data.object as Stripe.Checkout.Session;

        const userId = (s.metadata?.user_id || s.client_reference_id || "") as string;
        const courseId = (s.metadata?.course_id || "") as string;

        // Se tivermos e-mail, garantimos o usuário no banco
        let dbUserId = userId;
        if (!dbUserId && s.customer_details?.email) {
          const u = await client.query(
            "insert into users(email) values ($1) on conflict (email) do update set email=excluded.email returning id",
            [s.customer_details.email]
          );
          dbUserId = u.rows[0]?.id;
        }

        if (s.mode === "payment" && s.payment_intent) {
          const amountCents = s.amount_total ?? null;
          const currency = (s.currency || "BRL").toUpperCase();
          const productId = null; // mapeie price_id → product_id se desejar

          await client.query(
            "insert into purchases(user_id, product_id, stripe_payment_intent, status, amount_cents, currency) values ($1,$2,$3,'paid',$4,$5) on conflict (stripe_payment_intent) do update set status=excluded.status, amount_cents=excluded.amount_cents, currency=excluded.currency",
            [dbUserId || null, productId, String(s.payment_intent), amountCents, currency]
          );

          if (dbUserId && courseId) {
            await client.query(
              "insert into entitlements(user_id, course_id, source) values ($1,$2,'purchase') on conflict do nothing",
              [dbUserId, courseId]
            );
          }
        }

        if (s.mode === "subscription" && s.subscription) {
          await client.query(
            "insert into memberships(user_id, stripe_subscription_id, status, current_period_end) values ($1,$2,'active', to_timestamp($3)) on conflict (stripe_subscription_id) do update set status='active', current_period_end=to_timestamp($3)",
            [
              userId || null,
              String(s.subscription),
              typeof s.expires_at === "number" ? s.expires_at : Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
            ]
          );
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = evt.data.object as Stripe.Subscription;
        const status = sub.status as "active" | "incomplete" | "past_due" | "canceled" | "paused";
        const periodEnd = (sub.current_period_end as number | undefined) ?? Math.floor(Date.now() / 1000);

        await client.query(
          "insert into memberships(user_id, stripe_subscription_id, status, current_period_end) values (null,$1,$2,to_timestamp($3)) on conflict (stripe_subscription_id) do update set status=$2, current_period_end=to_timestamp($3)",
          [sub.id, status, periodEnd]
        );
        break;
      }

      default:
        // já registrado no event_log
        break;
    }

    await finishIdempotent(client, evt.id, "succeeded");
    await client.query("commit");
    return { statusCode: 200, body: "ok" };
  } catch {
    try { await client.query("rollback"); } catch {}
    return { statusCode: 500, body: "error" };
  } finally {
    client.release();
  }
};
