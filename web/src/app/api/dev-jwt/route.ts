// Rota Next para emitir um JWT de desenvolvimento (HS256, sub=UUID).
// GATES:
//   - DEV_JWT_ENABLED=1 (obriga habilitação explícita)
//   - Bloqueio forte em produção: se CONTEXT='production' (Netlify) OU NODE_ENV='production',
//     então só libera se DEV_JWT_ALLOW_IN_PRODUCTION=1 (opt-in consciente).
export const runtime = "nodejs";

import crypto from "crypto";

/** UUID v5 (determinístico a partir do e-mail + namespace) */
function uuidV5(name: string, namespace: string): string {
  const ns = /^[0-9a-fA-F-]{36}$/.test(namespace)
    ? namespace
    : "00000000-0000-0000-0000-000000000000";
  const nsBytes = Buffer.from(ns.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(name, "utf8");
  const sha1 = crypto.createHash("sha1");
  sha1.update(nsBytes);
  sha1.update(nameBytes);
  const hash = sha1.digest(); // 20 bytes
  const bytes = Buffer.from(hash.slice(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** Base64url helper */
function b64url(input: Buffer | string) {
  const base = (input instanceof Buffer ? input : Buffer.from(input))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return base;
}

/**
 * Tenta criar/obter userId (UUID) no banco quando DEV_JWT_UPSERT_DB=1.
 * Caso contrário (ou se falhar), gera UUID v5 determinístico a partir do e‑mail.
 * FECHA a conexão no finally, evitando leak mesmo em erro.
 */
async function createOrFetchUserId(email: string): Promise<string> {
  const wantDb =
    process.env.DEV_JWT_UPSERT_DB === "1" &&
    (process.env.PGHOST || process.env.DATABASE_URL);

  if (!wantDb) {
    const ns =
      process.env.DEV_USER_NAMESPACE_UUID ||
      "11111111-2222-3333-4444-555555555555";
    return uuidV5(email.toLowerCase(), ns);
  }

  // require dinâmico e não tipado — evita erro de build se "pg" não existir
  let Client: any = null;
  try {
    const req: any = (0, eval)("require");
    Client = req("pg").Client;
  } catch {
    const ns =
      process.env.DEV_USER_NAMESPACE_UUID ||
      "11111111-2222-3333-4444-555555555555";
    return uuidV5(email.toLowerCase(), ns);
  }

  let client: any = null;
  try {
    const config =
      process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {
            host: process.env.PGHOST,
            port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
            user: process.env.PGUSER,
            password: process.env.PGPASSWORD,
            database: process.env.PGDATABASE,
          };

    client = new Client(config);
    await client.connect();

    // Adapte ao seu schema real (este é um exemplo genérico).
    const sql = `
      INSERT INTO users (id, email)
      VALUES (gen_random_uuid(), $1)
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id
    `;
    const res = await client.query(sql, [email.toLowerCase()]);
    const userId: string | undefined = res?.rows?.[0]?.id;
    if (userId) return userId;

    const ns =
      process.env.DEV_USER_NAMESPACE_UUID ||
      "11111111-2222-3333-4444-555555555555";
    return uuidV5(email.toLowerCase(), ns);
  } catch {
    const ns =
      process.env.DEV_USER_NAMESPACE_UUID ||
      "11111111-2222-3333-4444-555555555555";
    return uuidV5(email.toLowerCase(), ns);
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // silencioso
      }
    }
  }
}

function isProductionContext() {
  const ctx = process.env.CONTEXT || ""; // Netlify: 'production' | 'deploy-preview' | 'branch-deploy'
  const vercel = process.env.VERCEL_ENV || ""; // Vercel: 'production' | 'preview' | 'development'
  const node = process.env.NODE_ENV || "";
  // Considera "produção" se CONTEXT='production' OU VERCEL_ENV='production' OU NODE_ENV='production'
  return ctx === "production" || vercel === "production" || node === "production";
}

const truthy = (value?: string | null) => {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true";
};

function getExternalApiBase() {
  return (process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");
}

function allowClientFallback() {
  return truthy(process.env.NEXT_PUBLIC_ALLOW_CLIENT_FAKE_JWT) || truthy(process.env.ALLOW_CLIENT_FAKE_JWT);
}

async function fetchUpstreamToken(search: string) {
  const base = getExternalApiBase();
  if (!base) return null;
  const upstreamUrl = `${base}/.netlify/functions/dev-jwt${search}`;
  const upstream = await fetch(upstreamUrl, { headers: { Accept: "text/plain" }, cache: "no-store" });
  const text = await upstream.text();
  if (!upstream.ok) {
    throw new Error(`upstream_${upstream.status}`);
  }
  const trimmed = text.trim();
  if (!trimmed) throw new Error("upstream_empty_body");
  return { token: trimmed, contentType: upstream.headers.get("content-type") };
}

function getSigningSecret() {
  const secret = process.env.JWT_SECRET || process.env.DEV_JWT_SECRET;
  if (secret) return secret;
  if (allowClientFallback()) return "insecure-dev-secret";
  return null;
}

export async function GET(req: Request) {
  if (process.env.DEV_JWT_ENABLED !== "1") {
    return new Response("Not Found", { status: 404 });
  }
  if (isProductionContext() && process.env.DEV_JWT_ALLOW_IN_PRODUCTION !== "1") {
    return new Response("Not Found", { status: 404 });
  }

  const url = new URL(req.url);
  const upstreamErrors: string[] = [];
  try {
    const upstream = await fetchUpstreamToken(url.search);
    if (upstream?.token) {
      return new Response(upstream.token, {
        status: 200,
        headers: {
          "Content-Type": upstream.contentType || "text/plain",
          "Cache-Control": "no-store",
          "X-Dev-Jwt-Source": "upstream",
        },
      });
    }
  } catch (err: any) {
    upstreamErrors.push(String(err?.message || err));
  }

  const email = url.searchParams.get("email") || "dev@example.com";
  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;
  const userId = await createOrFetchUserId(email);

  const secret = getSigningSecret();
  if (!secret) {
    return new Response(
      JSON.stringify({ error: "jwt_secret_missing", upstreamErrors }),
      {
        status: 502,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      }
    );
  }

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    email,
    role: "dev",
    iat: now,
    exp: now + day,
    iss: upstreamErrors.length ? "dev-jwt-local-fallback" : "dev-jwt-local",
    aud: "web",
    dev: true,
  };

  const headerPart = b64url(JSON.stringify(header));
  const payloadPart = b64url(JSON.stringify(payload));
  const toSign = `${headerPart}.${payloadPart}`;
  const signature = b64url(crypto.createHmac("sha256", secret).update(toSign).digest());
  const token = `${toSign}.${signature}`;

  const extraHeaders: Record<string, string> = {
    "Content-Type": "text/plain",
    "Cache-Control": "no-store",
    "X-Dev-Jwt-Source": "local",
  };
  if (upstreamErrors.length) {
    extraHeaders["X-Dev-Jwt-Upstream"] = upstreamErrors.join(";");
  }

  return new Response(token, { status: 200, headers: extraHeaders });
}
