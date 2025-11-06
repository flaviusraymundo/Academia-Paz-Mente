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

type EntitlementTarget = {
  courseId: string | null;
  trackId: string | null;
};

type EntitlementMetadata = EntitlementTarget & {
  durationDays: number | null;
  startsAtRaw: string | null;
  endsAtRaw: string | null;
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

  const firstOf = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = first(key);
      if (value) return value;
    }
    return undefined;
  };

  const durationRaw = firstOf(["entitlement_days", "duration_days"]);
  const duration = durationRaw ? Number(durationRaw) : NaN;

  return {
    courseId: first("course_id") ?? null,
    trackId: first("track_id") ?? null,
    durationDays: Number.isFinite(duration) && duration > 0 ? duration : null,
    startsAtRaw: first("starts_at") ?? null,
    endsAtRaw: first("ends_at") ?? null,
  };
}

function combineEntitlementMetadata(
  ...metas: (EntitlementMetadata | null | undefined)[]
): EntitlementMetadata {
  const result: EntitlementMetadata = {
    courseId: null,
    trackId: null,
    durationDays: null,
    startsAtRaw: null,
    endsAtRaw: null,
  };

  for (const meta of metas) {
    if (!meta) continue;
    if (!result.courseId && meta.courseId) result.courseId = meta.courseId;
    if (!result.trackId && meta.trackId) result.trackId = meta.trackId;
    if (!result.durationDays && meta.durationDays) result.durationDays = meta.durationDays;
    if (!result.startsAtRaw && meta.startsAtRaw) result.startsAtRaw = meta.startsAtRaw;
    if (!result.endsAtRaw && meta.endsAtRaw) result.endsAtRaw = meta.endsAtRaw;
  }

  return result;
}

function parseDateInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function computeWindow(meta: EntitlementMetadata): { startsAt: Date; endsAt: Date | null } {
  const now = new Date();
  const startsAt = parseDateInput(meta.startsAtRaw) ?? now;

  const explicitEnds = parseDateInput(meta.endsAtRaw);
  if (explicitEnds) {
    return { startsAt, endsAt: explicitEnds };
  }

  const duration = meta.durationDays;
  if (duration && duration > 0) {
    const endsAt = new Date(startsAt.getTime() + duration * 24 * 60 * 60 * 1000);
    return { startsAt, endsAt };
  }

  return { startsAt, endsAt: null };
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

  await client.query(
    `
    insert into entitlements
      (id, user_id, course_id, track_id, source, starts_at, ends_at, created_at)
    values
      (gen_random_uuid(), $1, $2, $3, coalesce($4, 'stripe'), $5::timestamptz, $6::timestamptz, now())
    on conflict (user_id, course_id) where $2 is not null do update
      set source = excluded.source, starts_at = excluded.starts_at, ends_at = excluded.ends_at
    on conflict (user_id, track_id)  where $3 is not null do update
      set source = excluded.source, starts_at = excluded.starts_at, ends_at = excluded.ends_at
    `,
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

async function metadataFromCharge(charge: Stripe.Charge): Promise<EntitlementMetadata> {
  const chargeMeta = resolveMetadata(charge.metadata ?? null);

  let invoiceMeta: EntitlementMetadata | null = null;
  let invoice: Stripe.Invoice | null = null;
  if (charge.invoice) {
    if (typeof charge.invoice === "string") {
      try {
        invoice = (await stripe.invoices.retrieve(charge.invoice, {
          expand: ["lines.data.price.product"],
        })) as Stripe.Invoice;
      } catch (err) {
        console.error("stripe-webhook invoice retrieve error", err);
      }
    } else {
      invoice = charge.invoice as Stripe.Invoice;
    }
  }

  if (invoice) {
    invoiceMeta = await metadataFromInvoice(invoice);
  }

  let subscriptionMeta: EntitlementMetadata | null = null;
  let subscriptionId: string | null = null;
  if (invoice && invoice.subscription) {
    subscriptionId =
      typeof invoice.subscription === "string"
        ? invoice.subscription
        : (invoice.subscription as Stripe.Subscription).id;
  }

  let paymentIntentMeta: EntitlementMetadata | null = null;
  if (charge.payment_intent) {
    try {
      const intent =
        typeof charge.payment_intent === "string"
          ? ((await stripe.paymentIntents.retrieve(charge.payment_intent)) as Stripe.PaymentIntent)
          : (charge.payment_intent as Stripe.PaymentIntent);
      paymentIntentMeta = resolveMetadata(intent.metadata ?? null);
    } catch (err) {
      console.error("stripe-webhook payment intent retrieve error", err);
    }
  }

  if (subscriptionId) {
    const subscription = await retrieveSubscription(subscriptionId);
    if (subscription) {
      subscriptionMeta = await metadataFromSubscription(subscription);
    }
  }

  return combineEntitlementMetadata(chargeMeta, invoiceMeta, subscriptionMeta, paymentIntentMeta);
}

async function findUserByEmail(client: PoolClient, email: string) {
  const normalized = email.trim().toLowerCase();
  const result = await client.query(`select id from users where email = $1`, [normalized]);
  return (result.rows[0] as { id: string } | undefined) ?? null;
}

async function revokeEntitlementByEmail(metadata: EntitlementMetadata, email: string) {
  const { courseId, trackId } = metadata;
  if (!email || (!courseId && !trackId)) return;

  await withClient(async (client) => {
    const user = await findUserByEmail(client, email);
    if (!user) return;

    await client.query(
      `
      update entitlements
         set ends_at = now()
       where user_id = $1
         and coalesce(course_id::text,'') = coalesce($2::text,'')
         and coalesce(track_id::text,'')  = coalesce($3::text,'')
         and source = 'stripe'
         and now() < coalesce(ends_at,'9999-12-31'::timestamptz)
      `,
      [user.id, courseId || null, trackId || null]
    );
  });
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
  const { courseId, trackId } = metadata;
  if (!email || (!courseId && !trackId)) return;

  const { startsAt, endsAt } = computeWindow(metadata);

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

  const evt = stripeEvent;

  try {
    const already = await pool.query(
      `insert into stripe_events_processed(id) values ($1) on conflict do nothing`,
      [evt.id]
    );
    if (already.rowCount === 0) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, dedup: true }) };
    }

    if (evt.type === "checkout.session.completed") {
      const session = evt.data.object as Stripe.Checkout.Session;
      const email = session.customer_details?.email || session.customer_email || "";
      if (email) {
        const metadata = await metadataFromCheckoutSession(session);
        await upsertFromEmail(metadata, email);
      }
    }

    if (evt.type === "invoice.paid") {
      const invoice = evt.data.object as Stripe.Invoice;
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

    if (evt.type === "customer.subscription.created") {
      const subscription = evt.data.object as Stripe.Subscription;
      const email = await getCustomerEmail(subscription.customer as any);
      if (email) {
        const metadata = await metadataFromSubscription(subscription);
        await upsertFromEmail(metadata, email);
      }
    }
    
    // Unificado: revogação por reembolso (charge.refunded OU refund.updated)
    if (evt.type === "charge.refunded" || evt.type === "refund.updated") {
      let charge: Stripe.Charge | null = null;

      if (evt.type === "charge.refunded") {
        charge = evt.data.object as Stripe.Charge;
      } else {
        const refund = evt.data.object as Stripe.Refund;
        if (refund.charge) {
          try {
            charge =
              typeof refund.charge === "string"
                ? ((await stripe.charges.retrieve(refund.charge)) as Stripe.Charge)
                : (refund.charge as Stripe.Charge);
          } catch (err) {
            console.error("stripe-webhook refund charge retrieve error", err);
          }
        }
      }

      if (charge) {
        let email =
          (charge.billing_details?.email as string | undefined) ||
          (charge.receipt_email as string | undefined) ||
          "";
        if (!email) {
          email = await getCustomerEmail(charge.customer as any);
        }

        if (email) {
          // Usa a cadeia completa de metadados (charge → invoice → subscription → payment_intent/checkout)
          const meta = await metadataFromCharge(charge);
          // Revoga somente entitlements criados pelo Stripe (source='stripe')
          await revokeEntitlementByEmail(meta, email);
        }
      }
    }      
    
  } catch (err) {
    console.error("stripe-webhook entitlement error", err);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
