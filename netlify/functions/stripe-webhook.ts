import Stripe from "stripe";
import { Pool } from "pg";
import type { PoolClient } from "pg";

type Handler = (event: any) => Promise<{ statusCode: number; body: string }>;

type StripeMeta = Stripe.Metadata | Stripe.MetadataParam | null | undefined;

type EntitlementWindow = {
  startsAt: Date;
  endsAt: Date | null;
};

type EntitlementTarget = {
  courseId: string | null;
  trackId: string | null;
};

type EntitlementMetadata = EntitlementTarget & {
  durationDays: number | null;
};

interface UpsertEntitlementArgs extends EntitlementTarget {
  userId: string;
  source?: string | null;
  startsAt: Date;
  endsAt: Date | null;
}

const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  throw new Error("STRIPE_SECRET_KEY missing for stripe-webhook");
}

const stripe = new Stripe(stripeSecret, {
  apiVersion: "2024-06-20",
});

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL missing for stripe-webhook");
}

const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSL ? { rejectUnauthorized: false } : undefined,
});

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

function readMetaValue(meta: StripeMeta, key: string): string | undefined {
  if (!meta) return undefined;
  const value = (meta as Record<string, unknown>)[key];
  if (value == null) return undefined;
  const str = String(value).trim();
  return str.length > 0 ? str : undefined;
}

function resolveMetadata(...sources: StripeMeta[]): EntitlementMetadata {
  const first = (key: string): string | undefined => {
    for (const meta of sources) {
      const value = readMetaValue(meta, key);
      if (value) return value;
    }
    return undefined;
  };

  const durationRaw = first("duration_days") ?? first("entitlement_days");
  const duration = durationRaw ? Number(durationRaw) : NaN;

  return {
    courseId: first("course_id") ?? null,
    trackId: first("track_id") ?? null,
    durationDays: Number.isFinite(duration) && duration > 0 ? duration : null,
  };
}

function computeWindow(durationDays: number | null): EntitlementWindow {
  const now = new Date();
  if (durationDays && durationDays > 0) {
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    return { startsAt: now, endsAt };
  }
  return { startsAt: now, endsAt: null };
}

async function ensureUserByEmail(client: PoolClient, email: string) {
  const normalized = email.trim().toLowerCase();
  const result = await client.query(
    `insert into users(id, email)
       values (gen_random_uuid(), $1)
     on conflict (email) do update set email = excluded.email
     returning id, email`,
    [normalized]
  );
  return result.rows[0] as { id: string; email: string };
}

async function getCustomerEmail(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined): Promise<string> {
  if (!customer) return "";
  if (typeof customer === "string") {
    try {
      const retrieved = await stripe.customers.retrieve(customer);
      return "deleted" in retrieved ? "" : ((retrieved as Stripe.Customer).email ?? "");
    } catch {
      return "";
    }
  }
  return "deleted" in customer ? "" : ((customer as Stripe.Customer).email ?? "");
}

async function upsertEntitlement(client: PoolClient, args: UpsertEntitlementArgs) {
  const { userId, courseId = null, trackId = null, source = "stripe", startsAt, endsAt } = args;
  if (!courseId && !trackId) {
    throw new Error("courseId_or_trackId_required");
  }

  const conflictClause = courseId
    ? "on conflict (user_id, course_id) do update set source = excluded.source, starts_at = excluded.starts_at, ends_at = excluded.ends_at"
    : "on conflict (user_id, track_id) do update set source = excluded.source, starts_at = excluded.starts_at, ends_at = excluded.ends_at";

  await client.query(
    `insert into entitlements(id, user_id, course_id, track_id, source, starts_at, ends_at, created_at)
       values (gen_random_uuid(), $1, $2, $3, coalesce($4, 'stripe'), $5::timestamptz, $6::timestamptz, now())
       ${conflictClause}`,
    [userId, courseId, trackId, source, startsAt, endsAt]
  );
}

async function metadataFromCheckoutSession(session: Stripe.Checkout.Session): Promise<EntitlementMetadata> {
  let subscriptionMeta: Stripe.Metadata | null = null;
  let priceMeta: Stripe.Metadata | null = null;
  let paymentIntentMeta: Stripe.Metadata | null = null;

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      subscriptionMeta = subscription.metadata ?? null;
      priceMeta = subscription.items?.data?.[0]?.price?.metadata ?? null;
    } catch {
      // ignore fetch errors
    }
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      paymentIntentMeta = paymentIntent.metadata ?? null;
    } catch {
      // ignore fetch errors
    }
  }

  return resolveMetadata(priceMeta, subscriptionMeta, paymentIntentMeta, session.metadata);
}

async function metadataFromInvoice(invoice: Stripe.Invoice): Promise<EntitlementMetadata> {
  const lineItem = invoice.lines?.data?.[0];
  const priceMeta = lineItem?.price?.metadata ?? null;

  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;
  if (subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      return resolveMetadata(
        subscription.items?.data?.[0]?.price?.metadata ?? null,
        subscription.metadata ?? null,
        invoice.metadata,
        priceMeta
      );
    } catch {
      // ignore fetch errors
    }
  }

  return resolveMetadata(invoice.metadata, priceMeta);
}

async function metadataFromSubscription(subscription: Stripe.Subscription): Promise<EntitlementMetadata> {
  return resolveMetadata(
    subscription.items?.data?.[0]?.price?.metadata ?? null,
    subscription.metadata ?? null
  );
}

async function upsertFromEmail(metadata: EntitlementMetadata, email: string) {
  const trimmed = email.trim();
  if (!trimmed) return;
  const { courseId, trackId, durationDays } = metadata;
  if (!courseId && !trackId) return;
  const { startsAt, endsAt } = computeWindow(durationDays);

  await withClient(async (client) => {
    const user = await ensureUserByEmail(client, trimmed);
    await upsertEntitlement(client, {
      userId: user.id,
      courseId,
      trackId,
      source: "stripe",
      startsAt,
      endsAt,
    });
  });
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "method_not_allowed" };
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET missing for stripe-webhook");
    return { statusCode: 500, body: "stripe_env_missing" };
  }

  const signature =
    event.headers?.["stripe-signature"] ??
    event.headers?.["Stripe-Signature"] ??
    event.headers?.["STRIPE-SIGNATURE"];
  if (!signature) {
    return { statusCode: 400, body: "missing_signature" };
  }

  const rawBody: Buffer = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : Buffer.from(event.body || "", "utf8");

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("stripe-webhook invalid signature", err);
    return { statusCode: 400, body: "invalid_signature" };
  }

  try {
    await withClient(async (client) => {
      const inserted = await client.query(
        `insert into stripe_webhook_events(id, type)
           values ($1, $2)
         on conflict (id) do nothing`,
        [stripeEvent.id, stripeEvent.type]
      );
      if (inserted.rowCount === 0) {
        const error = new Error("already_processed") as Error & { code?: string };
        error.code = "ALREADY";
        throw error;
      }
    });

    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object as Stripe.Checkout.Session;
      const email = session.customer_details?.email || session.customer_email || "";
      if (email) {
        const metadata = await metadataFromCheckoutSession(session);
        await upsertFromEmail(metadata, email);
      }
    }

    if (stripeEvent.type === "invoice.paid") {
      const invoice = stripeEvent.data.object as Stripe.Invoice;
      let email = invoice.customer_email || "";
      if (!email) {
        email = await getCustomerEmail(invoice.customer as any);
      }
      if (email) {
        const metadata = await metadataFromInvoice(invoice);
        await upsertFromEmail(metadata, email);
      }
    }

    if (stripeEvent.type === "customer.subscription.created") {
      const subscription = stripeEvent.data.object as Stripe.Subscription;
      const email = await getCustomerEmail(subscription.customer as any);
      if (email) {
        const metadata = await metadataFromSubscription(subscription);
        await upsertFromEmail(metadata, email);
      }
    }

    if (stripeEvent.type === "charge.refunded" || stripeEvent.type === "refund.updated") {
      await withClient(async (client) => {
        let email = "";
        let meta: Stripe.Metadata | null = null;

        if (stripeEvent.type === "charge.refunded") {
          const charge = stripeEvent.data.object as Stripe.Charge;
          email = (charge.billing_details?.email as string) || "";
          if (!email && charge.customer) {
            email = await getCustomerEmail(charge.customer as any);
          }
          if (typeof charge.payment_intent === "string") {
            try {
              const paymentIntent = await stripe.paymentIntents.retrieve(charge.payment_intent);
              meta = paymentIntent.metadata ?? null;
            } catch {
              meta = null;
            }
          }
        } else {
          const refund = stripeEvent.data.object as Stripe.Refund;
          if (refund.charge) {
            try {
              const charge =
                typeof refund.charge === "string"
                  ? await stripe.charges.retrieve(refund.charge)
                  : (refund.charge as Stripe.Charge);
              email = (charge.billing_details?.email as string) || "";
              if (!email && charge.customer) {
                email = await getCustomerEmail(charge.customer as any);
              }
              const paymentIntentRaw = charge.payment_intent as string | Stripe.PaymentIntent | null | undefined;
              const paymentIntentId =
                typeof paymentIntentRaw === "string"
                  ? paymentIntentRaw
                  : paymentIntentRaw?.id;
              if (paymentIntentId) {
                try {
                  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
                  meta = paymentIntent.metadata ?? null;
                } catch {
                  meta = null;
                }
              }
            } catch {
              email = "";
              meta = null;
            }
          }
        }

        if (!email) return;
        const courseId = readMetaValue(meta, "course_id") ?? null;
        const trackId = readMetaValue(meta, "track_id") ?? null;
        if (!courseId && !trackId) return;

        await client.query(
          `update entitlements
              set ends_at = now()
            where source = 'stripe'
              and coalesce(course_id::text, '') = coalesce($2::text, '')
              and coalesce(track_id::text, '') = coalesce($3::text, '')
              and now() < coalesce(ends_at, '9999-12-31'::timestamptz)
              and user_id = (
                select id from users where lower(email) = lower($1) limit 1
              )`,
          [email, courseId, trackId]
        );
      });
    }
  } catch (err) {
    if ((err as any)?.code === "ALREADY") {
      return { statusCode: 200, body: JSON.stringify({ received: true, dedup: true }) };
    }
    console.error("stripe-webhook entitlement error", err);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
