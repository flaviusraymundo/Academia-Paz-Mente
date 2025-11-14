// Rota Next para emitir um JWT de desenvolvimento.
// GATED: somente se DEV_JWT_ENABLED=1 e NODE_ENV !== 'production'.
// sub é um UUID válido (obtido via upsert opcional em DB ou gerado determinístico v5).
export const runtime = "nodejs";

import { signHS256, uuidV5 } from "../../../lib/server/jwt";

/**
 * Tenta criar/obter userId (UUID) no banco quando DEV_JWT_UPSERT_DB=1.
 * Caso contrário (ou se falhar), gera UUID v5 determinístico a partir do e‑mail.
 * FECHA a conexão no finally, evitando leak mesmo em erro.
 *
 * Importante: não referenciar tipos de "pg" e não usar require direto,
 * para não forçar o TypeScript a resolver o módulo em build.
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

    // Adapte ao seu schema real.
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
  const isProd = process.env.NODE_ENV === "production";
  if (!enabled || isProd) {
    // Esconde a existência do endpoint em produção/desabilitado
    return new Response("Not Found", { status: 404 });
  }

  const url = new URL(req.url);
  const email = url.searchParams.get("email") || "dev@example.com";
  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;

  // sub: UUID válido (compatível com middleware que espera uuid)
  const userId = await createOrFetchUserId(email);

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
  const token = signHS256(payload, secret);

  return new Response(token, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
