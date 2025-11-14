// Rota Next para emitir um JWT de desenvolvimento.
// GATED: só funciona se DEV_JWT_ENABLED=1 E não está em produção.
// Assina token com HS256 (não usar alg "none").
// runtime nodejs para permitir uso de crypto.
export const runtime = "nodejs";

import crypto from "crypto";

function b64url(input: Buffer | string) {
  const base = (input instanceof Buffer ? input : Buffer.from(input))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return base;
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

  const header = { alg: "HS256", typ: "JWT" } as const;
  const payload = {
    sub: email,
    email,
    role: "dev",
    iat: now,
    exp: now + day,
    iss: "dev-jwt-local",
    aud: "web",
    dev: true,
  };

  const secret = process.env.DEV_JWT_SECRET || "insecure-dev-secret";

  const headerPart = b64url(JSON.stringify(header));
  const payloadPart = b64url(JSON.stringify(payload));
  const toSign = `${headerPart}.${payloadPart}`;
  const signature = b64url(crypto.createHmac("sha256", secret).update(toSign).digest());
  const token = `${toSign}.${signature}`;

  return new Response(token, { status: 200, headers: { "Content-Type": "text/plain" } });
}
