// netlify/functions/stripe-webhook.ts
import Stripe from "stripe";
import { pool } from "../../src/server/lib/db.ts";
import { beginIdempotent, finishIdempotent } from "../../src/server/lib/idempotency.ts";
import { ulid } from "ulid";

// Observação:
// - Esta função é separada do app Express porque o webhook da Stripe precisa do body "cru" (raw).
// - Em DEV_FAKE=1, gravamos um evento simplificado e retornamos OK (sem Stripe real).

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "method_not_allowed" };
  }

  const DEV_FAKE = process.env.DEV_FAKE === "1";
  if (DEV_FAKE) {
    try {
      await pool.query(
        `insert into event_log(event_id, topic, occurred_at, source, payload)
         values ($1,'dev.stripe', now(),'app', $2)`,
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

  // Caixa de entrada + idempotência
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
      `insert into webhook_inbox(provider, provider_event_id, payload)
       values ('stripe',$1,$2)
       on conflict (provider, provider_event_id) do nothing`,
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
      `insert into event_log(event_id, topic, occurred_at, source, payload)
       values ($1,$2, to_timestamp($3), 'stripe', $4)`,
      [eventId, evt.type, occurredUnix, evt.data.object as any]
    );

    // ===== Atualizações mínimas de domínio =====
    switch (evt.type) {
      case "checkout.session.completed": {
        const s = evt.data.object as Stripe.Checkout.Session;

        const userId = (s.metadata?.user_id ||
          s.client_reference_id ||
          "") as string;
        const courseId = (s.metadata?.course_id || "") as string;

        // Se tivermos e-mail, garantimos o usuário no banco
        let dbUserId = userId;
        if (!dbUserId && s.customer_details?.email) {
          const u = await client.query(
            `insert into users(email) values ($1)
             on conflict (email) do update set email=excluded.email
             returning id`,
            [s.customer_details.email]
          );
          dbUserId = u.rows[0]?.id;
        }

        if (s.mode === "payment" && s.payment_intent) {
          // Compra avulsa
          const amountCents = s.amount_total ?? null;
          const currency = (s.currency || "BRL").toUpperCase();

          // Vincule a um "products" real pelo price_id se desejar
          const productId = null;

          await client.query(
            `insert into purchases(user_id, product_id, stripe_payment_intent, status, amount_cents, currency)
             values ($1,$2,$3,'paid',$4,$5)
             on conflict (stripe_payment_intent) do update
               set status=excluded.status, amount_cents=excluded.amount_cents, currency=excluded.currency`,
            [dbUserId || null, productId, String(s.payment_intent), amountCents, currency]
          );

          // Concede entitlement ao curso se informado
          if (dbUserId && courseId) {
            await client.query(
              `insert into entitlements(user_id, course_id, source)
               values ($1,$2,'purcha
