export const runtime = "nodejs";

import {
  buildSessionCookie,
  getUserIdFromEmail,
  normalizeEmail,
  signHS256,
} from "../_utils";
import { isCookieModeEnabled } from "../../../../lib/cookieMode";

export async function POST(req: Request) {
  // Cookie mode precisa estar habilitado no servidor
  if (!isCookieModeEnabled()) {
    return new Response(JSON.stringify({ error: "Auth cookie disabled" }), { status: 404 });
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
