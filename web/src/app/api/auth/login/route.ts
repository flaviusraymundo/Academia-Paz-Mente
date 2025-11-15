export const runtime = "nodejs";

import {
  buildSessionCookie,
  getUserIdFromEmail,
  normalizeEmail,
  signHS256,
} from "../_utils";

export async function POST(req: Request) {
  // Gate explícito com mensagem clara (não 404 silencioso)
  if (process.env.COOKIE_MODE !== "1") {
    return new Response(
      JSON.stringify({
        error: "COOKIE_MODE_DISABLED",
        detail:
          "Rota /api/auth/login não habilitada: defina COOKIE_MODE=1 no ambiente do build (server).",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const secret = process.env.JWT_SECRET || process.env.DEV_JWT_SECRET || "insecure-dev-secret";
  try {
    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail(String(body?.email || ""));
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return new Response(JSON.stringify({ error: "invalid email" }), { status: 400 });
    }

    const userId = await getUserIdFromEmail(email);
    const now = Math.floor(Date.now() / 1000);
    const day = 24 * 60 * 60;

    const token = signHS256(
      {
        sub: userId,
        email,
        iat: now,
        exp: now + day,
        iss: "auth-cookie",
        aud: "web",
      },
      secret
    );

    const headers = new Headers();
    headers.append("Set-Cookie", buildSessionCookie(token, day));
    headers.append("Content-Type", "application/json");
    headers.append("Cache-Control", "no-store");

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
}

// Para testes rápidos via GET (opcional - não documentado em produção)
export async function GET() {
  if (process.env.COOKIE_MODE !== "1") {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "COOKIE_MODE_DISABLED",
        detail: "Defina COOKIE_MODE=1 para habilitar login por cookie.",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  return new Response(
    JSON.stringify({
      ok: false,
      error: "METHOD_NOT_ALLOWED",
      detail: "Use POST para /api/auth/login",
    }),
    { status: 405, headers: { "Content-Type": "application/json" } }
  );
}
