import Stripe from "stripe";
import { Pool } from "pg";
import type { PoolClient } from "pg";

type Handler = (event: any) => Promise<{ statusCode: number; body: string }>;

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

  const durationRaw = first("duration_days");
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

interface UpsertEntitlementArgs extends EntitlementTarget {
  userId: string;
  source?: string | null;
  startsAt: Date;
  endsAt: Date | null;
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

async function getProductMetadata(price: Stripe.Price | null | undefined) {
  if (!price) return null;
  const product = price.product;
  if (!product) return null;
  if (typeof product === "string") {
    try {
      const prod = await stripe.products.retrieve(product);
      return prod.metadata ?? null;
    } catch (err) {
      console.error("stripe-webhook product metadata error", err);
      return null;
    }
  }
  if ("deleted" in product && product.deleted) {
    return null;
  }
  return (product as Stripe.Product).metadata ?? null;
}

async function metadataFromCheckoutSession(session: Stripe.Checkout.Session): Promise<EntitlementMetadata> {
  let priceMeta: Stripe.Metadata | null = null;
  let productMeta: Stripe.Metadata | null = null;

  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 1,
      expand: ["data.price.product"],
    });
    const lineItem = lineItems.data[0];
    const price = lineItem?.price ?? null;
    priceMeta = price?.metadata ?? null;
    productMeta = await getProductMetadata(price);
  } catch (err) {
    console.error("stripe-webhook checkout line items error", err);
  }

  const sessionMeta = session.metadata ?? null;
  return resolveMetadata(priceMeta, productMeta, sessionMeta);
}

async function metadataFromInvoice(invoice: Stripe.Invoice): Promise<EntitlementMetadata> {
  const lineItem = invoice.lines?.data?.[0];
  const price = lineItem?.price ?? null;
  const priceMeta = price?.metadata ?? null;
  const productMeta = await getProductMetadata(price);
  const invoiceMeta = invoice.metadata ?? null;
  return resolveMetadata(priceMeta, productMeta, invoiceMeta);
}

async function metadataFromSubscription(subscription: Stripe.Subscription): Promise<EntitlementMetadata> {
  const price = subscription.items?.data?.[0]?.price ?? null;
  const priceMeta = price?.metadata ?? null;
  const productMeta = await getProductMetadata(price);
  const subscriptionMeta = subscription.metadata ?? null;
  return resolveMetadata(priceMeta, productMeta, subscriptionMeta);
}

async function getCustomerEmail(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined): Promise<string> {
  if (!customer) return "";
  if (typeof customer === "string") {
    try {
      const retrieved = await stripe.customers.retrieve(customer);
      if (!retrieved.deleted) {
        return (retrieved as Stripe.Customer).email ?? "";
      }
      return "";
    } catch (err) {
      console.error("stripe-webhook customer retrieve error", err);
      return "";
    }
  }
  if ("deleted" in customer) {
    return "";
  }
  return (customer as Stripe.Customer).email ?? "";
}

async function retrieveSubscription(
  subscription: string | Stripe.Subscription | null | undefined
): Promise<Stripe.Subscription | null> {
  if (!subscription) return null;
  if (typeof subscription !== "string") {
    return subscription;
  }
  try {
    const sub = (await stripe.subscriptions.retrieve(subscription)) as Stripe.Subscription;
    return sub ?? null;
  } catch (err) {
    console.error("stripe-webhook subscription retrieve error", err);
    return null;
  }
}

async function upsertFromEmail(metadata: EntitlementMetadata, email: string) {
  const { courseId, trackId, durationDays } = metadata;
  if (!email || (!courseId && !trackId)) return;

  const { startsAt, endsAt } = computeWindow(durationDays);

  await withClient(async (client) => {
    const user = await ensureUserByEmail(client, email);
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

function getStripeSignature(headers: Record<string, string | undefined>): string | undefined {
  return (
    headers["stripe-signature"] ||
    headers["Stripe-Signature"] ||
    headers["STRIPE-SIGNATURE"]
  );
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "method_not_allowed" };
  }

  const devFake = process.env.DEV_FAKE === "1";
  if (devFake) {
    return { statusCode: 200, body: JSON.stringify({ received: true, mode: "dev_fake" }) };
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("stripe-webhook missing env");
    return { statusCode: 500, body: "stripe_env_missing" };
  }

  const signature = getStripeSignature(event.headers as Record<string, string | undefined>);
  if (!signature) {
    return { statusCode: 400, body: "missing_signature" };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64")
    : Buffer.from(event.body ?? "", "utf8");

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err: any) {
    console.error("stripe-webhook signature error", err);
    return { statusCode: 400, body: "invalid_signature" };
  }

  try {
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
      let email = invoice.customer_email ?? "";
      if (!email) {
        email = await getCustomerEmail(invoice.customer as any);
      }
      if (email) {
        let metadata = await metadataFromInvoice(invoice);
        if (!metadata.courseId && !metadata.trackId) {
          const subscription = await retrieveSubscription(invoice.subscription as any);
          if (subscription) {
            metadata = await metadataFromSubscription(subscription);
          }
        }
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
  } catch (err) {
    console.error("stripe-webhook entitlement error", err);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
