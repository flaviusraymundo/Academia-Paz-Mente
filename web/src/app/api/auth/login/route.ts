export const runtime = "nodejs";

import { buildSessionCookie, normalizeEmail } from "../_utils";
import { isCookieModeEnabled } from "../../../../lib/cookieMode";

const DAY_SECONDS = 24 * 60 * 60;

function getExternalApiBase() {
  return process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || "";
}

function getSetCookieValues(headers: Headers): string[] {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function extractSessionToken(rawCookies: string[]): string | null {
  for (const cookie of rawCookies) {
    const match = /(?:^|;\s*)session=([^;]+)/.exec(cookie);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

export async function POST(req: Request) {
  const apiBase = getExternalApiBase();
  if (!apiBase) {
    return new Response(JSON.stringify({ error: "API base não configurada" }), { status: 500 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail(String(body?.email || ""));
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return new Response(JSON.stringify({ error: "invalid email" }), { status: 400 });
    }

    const upstreamUrl = `${apiBase.replace(/\/+$/, "")}/api/auth/login`;
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const text = await upstream.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!upstream.ok) {
      const headers = new Headers({ "Content-Type": "application/json" });
      return new Response(text || JSON.stringify({ error: "login_failed" }), {
        status: upstream.status,
        headers,
      });
    }

    let token: string | null = data?.token || null;
    if (!token) {
      const cookieToken = extractSessionToken(getSetCookieValues(upstream.headers));
      if (cookieToken) token = cookieToken;
    }

    if (!token) {
      return new Response(JSON.stringify({ error: "token_missing" }), { status: 502 });
    }

    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });

    if (isCookieModeEnabled()) {
      headers.append("Set-Cookie", buildSessionCookie(token, DAY_SECONDS));
    }

    return new Response(JSON.stringify({ token }), { status: 200, headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
}
