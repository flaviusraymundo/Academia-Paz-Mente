// Rota Next para emitir um JWT de desenvolvimento.
// GATED: somente se DEV_JWT_ENABLED=1 e NODE_ENV !== 'production'.
// sub agora é um UUID válido (obtido via upsert opcional ou gerado determinístico v5).
export const runtime = "nodejs";

import crypto from "crypto";

// --- UUID v5 util (namespace + name) ---
function uuidV5(name: string, namespace: string): string {
  // namespace deve ser UUID válido; se inválido usa fallback.
  const nsHex = namespace.replace(/-/g, "");
  if (nsHex.length !== 32) {
    namespace = "00000000-0000-0000-0000-000000000000";
  }
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(name, "utf8");
  const sha1 = crypto.createHash("sha1");
  sha1.update(nsBytes);
  sha1.update(nameBytes);
  const hash = sha1.digest(); // 20 bytes
  // Converte para UUID, ajusta versão (5) e variant.
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

// --- HS256 util ---
function b64url(input: Buffer | string) {
  const base = (input instanceof Buffer ? input : Buffer.from(input))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return base;
}

// Tenta usar pg para criar/obter userId real (opcional). Se não disponível, fallback para UUID v5.
async function createOrFetchUserId(email: string): Promise<string> {
  // Requer que você tenha a dependência 'pg' instalada e variáveis PGHOST/PGUSER/PGPASSWORD/PGDATABASE.
  // Caso contrário, cai no determinístico v5.
  try {
    // Lazy import para não quebrar bundle se 'pg' não estiver instalado.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Client } = require("pg") as typeof import("pg");
    const client = new Client({
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    });
    await client.connect();
    // Adapte para seu schema real. Exemplo simples:
    // Tabela users(id uuid pk, email text unique).
    // Se não existir, ajuste ou remova a parte SQL.
    const upsertSql = `
      INSERT INTO users (id, email)
      VALUES (gen_random_uuid(), $1)
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id
    `;
    const res = await client.query<{ id: string }>(upsertSql, [email]);
    const userId = res.rows[0]?.id;
    await client.end();
    if (userId && typeof userId === "string") return userId;
    // Fallback se algo não retornou
  } catch {
    // Silencioso: fallback para UUID v5
  }
  const ns = process.env.DEV_USER_NAMESPACE_UUID || "11111111-2222-3333-4444-555555555555";
  return uuidV5(email.toLowerCase(), ns);
}

export async function GET(req: Request) {
  const enabled = process.env.DEV_JWT_ENABLED === "1";
  const isProd = process.env.NODE_ENV === "production";
  if (!enabled || isProd) {
    // Esconde a existência do endpoint em produção/desabilitado
    return new Response("Not Found", { status: 404 });
  }

  const url = new URL(req.url);
  const email = url.searchParams.get("email") || "dev@example.com";
  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;

  // Obtém userId (UUID válido)
  const userId = await createOrFetchUserId(email);

  const header = { alg: "HS256", typ: "JWT" } as const;
  const payload = {
    sub: userId, // UUID compatível com middleware
    email,
    role: "dev",
    iat: now,
    exp: now + day,
    iss: "dev-jwt-local",
    aud: "web",
    dev: true,
  };

  // IMPORTANTE: usar a mesma chave que o backend usa para validar (JWT_SECRET).
  // Fallback para DEV_JWT_SECRET apenas se JWT_SECRET não estiver definida no ambiente DEV.
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
