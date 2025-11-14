// Rota Next para emitir um JWT de desenvolvimento.
// GATED: habilitada somente quando DEV_JWT_ENABLED=1.
// sub é um UUID válido (via upsert opcional em DB ou UUID v5 determinístico).
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

export async function GET(req: Request) {
  const enabled = process.env.DEV_JWT_ENABLED === "1";
  if (!enabled) {
    // Esconde a existência do endpoint quando desabilitado
    return new Response("Not Found", { status: 404 });
  }

  const url = new URL(req.url);
  const email = url.searchParams.get("email") || "dev@example.com";
  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;

  // sub: UUID válido (compatível com middleware que espera uuid)
  const userId = await createOrFetchUserId(email);

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    email,
    role: "dev",
    iat: now,
    exp: now + day,
    iss: "dev-jwt-local",
    aud: "web",
    dev: true,
  };

  // Assina com JWT_SECRET para alinhar com middleware
  const secret =
    process.env.JWT_SECRET || process.env.DEV_JWT_SECRET || "insecure-dev-secret";

  const headerPart = b64url(JSON.stringify(header));
  const payloadPart = b64url(JSON.stringify(payload));
  const toSign = `${headerPart}.${payloadPart}`;
  const signature = b64url(crypto.createHmac("sha256", secret).update(toSign).digest());
  const token = `${toSign}.${signature}`;

  return new Response(token, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
