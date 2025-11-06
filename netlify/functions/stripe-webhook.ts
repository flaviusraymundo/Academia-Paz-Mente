import Stripe from "stripe";
import type { PoolClient } from "pg";
import { pool } from "../../src/server/lib/db.ts";
import { beginIdempotent, finishIdempotent } from "../../src/server/lib/idempotency.ts";
import { ACTIVE_ENTITLEMENT_CLAUSE } from "../../src/server/lib/entitlements.ts";
import { ulid } from "ulid";

const ACTIVE_SQL = ACTIVE_ENTITLEMENT_CLAUSE;

type UpsertEntArgs = {
  userId: string;
  courseId?: string | null;
  trackId?: string | null;
  source?: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

async function ensureUserByEmail(client: PoolClient, email: string) {
  const normalized = email.trim();
  const { rows } = await client.query<{ id: string; email: string }>(
    `insert into users(id, email)
       values (gen_random_uuid(), $1)
       on conflict (email) do update set email = excluded.email
       returning id, email`,
    [normalized]
  );
  return rows[0];
}

async function findUserByEmail(client: PoolClient, email: string) {
  const { rows } = await client.query<{ id: string; email: string }>(
    `select id, email from users where lower(email) = lower($1) limit 1`,
    [email.trim()]
  );
  return rows[0] || null;
}

async function upsertEntitlement(client: PoolClient, args: UpsertEntArgs) {
  const {
    userId,
    courseId = null,
    trackId = null,
    source = "stripe",
    startsAt = null,
    endsAt = null,
  } = args;
  if (!courseId && !trackId) throw new Error("courseId_or_trackId_required");

  const conflict = courseId
    ? "on conflict (user_id, course_id) do update set source=excluded.source, starts_at=excluded.starts_at, ends_at=excluded.ends_at"
    : "on conflict (user_id, track_id) do update set source=excluded.source, starts_at=excluded.starts_at, ends_at=excluded.ends_at";

  const params = [
    userId,
    courseId,
    trackId,
    source,
    startsAt ? startsAt.toISOString() : null,
    endsAt ? endsAt.toISOString() : null,
  ];

  await client.query(
    `insert into entitlements(id, user_id, course_id, track_id, source, starts_at, ends_at, created_at)
       values (gen_random_uuid(), $1, $2, $3, $4, coalesce($5::timestamptz, now()), $6::timestamptz, now())
       ${conflict}`,
    params
  );
}

async function revokeEntitlement(
  client: PoolClient,
  args: { userId: string; courseId?: string | null; trackId?: string | null }
) {
  const { userId, courseId = null, trackId = null } = args;
  if (!courseId && !trackId) throw new Error("courseId_or_trackId_required");

  await client.query(
    `update entitlements
        set ends_at = now()
      where user_id = $1
        and coalesce(course_id::text,'') = coalesce($2,'')
        and coalesce(track_id::text,'') = coalesce($3,'')
        and ${ACTIVE_SQL}`,
    [userId, courseId, trackId]
  );
}

function parseWindowFromMeta(meta?: Stripe.Metadata | Stripe.MetadataParam | null) {
  const raw = meta?.entitlement_days as string | undefined;
  const days = raw ? Number(raw) : NaN;
  if (!Number.isFinite(days) || days <= 0) {
    return { startsAt: null as Date | null, endsAt: null as Date | null };
  }
  const startsAt = new Date();
  const endsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return { startsAt, endsAt };
}

function parseTargetFromMeta(meta?: Stripe.Metadata | Stripe.MetadataParam | null) {
  const courseIdRaw = meta?.course_id as string | undefined;
  const trackIdRaw = meta?.track_id as string | undefined;
  const courseId = courseIdRaw && courseIdRaw.trim() ? courseIdRaw.trim() : null;
  const trackId = trackIdRaw && trackIdRaw.trim() ? trackIdRaw.trim() : null;
  return { courseId, trackId };
}

async function resolveEmailFromCustomerId(stripe: Stripe, customerId?: string | null) {
  if (!customerId) return "";
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if ((customer as Stripe.DeletedCustomer).deleted) return "";
    return (customer as Stripe.Customer).email || "";
  } catch (err) {
    console.error("stripe-webhook resolveEmailFromCustomerId error", err);
    return "";
  }
}

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
        const session = evt.data.object as Stripe.Checkout.Session;
        const meta = session.metadata || null;
        const { courseId, trackId } = parseTargetFromMeta(meta);
        const { startsAt, endsAt } = parseWindowFromMeta(meta);

        let userId = (session.metadata?.user_id || session.client_reference_id || "") as string;
        const email = session.customer_details?.email || session.customer_email || "";

        if (email) {
          const ensured = await ensureUserByEmail(client, email);
          userId = ensured?.id || userId;
        }

        if (session.mode === "payment" && session.payment_intent) {
          const amountCents = session.amount_total ?? null;
          const currency = (session.currency || "BRL").toUpperCase();
          const productId = null; // mapeie price_id → product_id se desejar

          await client.query(
            "insert into purchases(user_id, product_id, stripe_payment_intent, status, amount_cents, currency) values ($1,$2,$3,'paid',$4,$5) on conflict (stripe_payment_intent) do update set status=excluded.status, amount_cents=excluded.amount_cents, currency=excluded.currency",
            [userId || null, productId, String(session.payment_intent), amountCents, currency]
          );

          if (userId && (courseId || trackId)) {
            await upsertEntitlement(client, {
              userId,
              courseId,
              trackId,
              source: "stripe",
              startsAt,
              endsAt,
            });
          }
        }

        if (session.mode === "subscription" && session.subscription) {
          await client.query(
            "insert into memberships(user_id, stripe_subscription_id, status, current_period_end) values ($1,$2,'active', to_timestamp($3)) on conflict (stripe_subscription_id) do update set status='active', current_period_end=to_timestamp($3)",
            [
              userId || null,
              String(session.subscription),
              typeof session.expires_at === "number"
                ? session.expires_at
                : Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
            ]
          );

          if (userId && (courseId || trackId)) {
            await upsertEntitlement(client, {
              userId,
              courseId,
              trackId,
              source: "stripe",
              startsAt,
              endsAt,
            });
          }
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

    if (evt.type === "invoice.paid" || evt.type === "customer.subscription.created") {
      let subscription: Stripe.Subscription | null = null;
      if (evt.type === "invoice.paid") {
        const invoice = evt.data.object as Stripe.Invoice;
        const subId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id;
        if (subId) {
          subscription = await stripe.subscriptions.retrieve(subId);
        }
      } else {
        subscription = evt.data.object as Stripe.Subscription;
      }

      if (subscription) {
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id || null;
        const email = await resolveEmailFromCustomerId(stripe, customerId);
        if (email) {
          const ensured = await ensureUserByEmail(client, email);
          if (ensured) {
            const price = subscription.items?.data?.[0]?.price;
            const meta = (price?.metadata ?? subscription.metadata) || null;
            const { courseId, trackId } = parseTargetFromMeta(meta);
            const { startsAt, endsAt } = parseWindowFromMeta(meta);
            if (courseId || trackId) {
              await upsertEntitlement(client, {
                userId: ensured.id,
                courseId,
                trackId,
                source: "stripe",
                startsAt,
                endsAt,
              });
            }
          }
        }
      }
    }

    if (evt.type === "charge.refunded" || evt.type === "refund.updated") {
      let paymentIntentId: string | null = null;
      let customerId: string | null = null;

      if (evt.type === "charge.refunded") {
        const charge = evt.data.object as Stripe.Charge;
        paymentIntentId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : null;
        customerId =
          typeof charge.customer === "string"
            ? charge.customer
            : charge.customer?.id || null;
      } else {
        const refund = evt.data.object as Stripe.Refund;
        const chargeId =
          typeof refund.charge === "string"
            ? refund.charge
            : refund.charge?.id;
        if (chargeId) {
          const charge = await stripe.charges.retrieve(chargeId);
          paymentIntentId =
            typeof charge.payment_intent === "string"
              ? charge.payment_intent
              : null;
          customerId =
            typeof charge.customer === "string"
              ? charge.customer
              : (charge.customer as Stripe.Customer | Stripe.DeletedCustomer | null)?.id || null;
        }
      }

      if (paymentIntentId) {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        const meta = paymentIntent.metadata || null;
        const { courseId, trackId } = parseTargetFromMeta(meta);
        if (courseId || trackId) {
          const email =
            (paymentIntent.receipt_email as string | null) ||
            (await resolveEmailFromCustomerId(stripe, customerId));
          if (email) {
            const existing = await findUserByEmail(client, email);
            if (existing) {
              await revokeEntitlement(client, {
                userId: existing.id,
                courseId,
                trackId,
              });
            }
          }
        }
      }
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
