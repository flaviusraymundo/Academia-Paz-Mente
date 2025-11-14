export const runtime = "nodejs";

import { verifyHS256 } from "../_utils";

export async function GET(req: Request) {
  const secret = process.env.JWT_SECRET || process.env.DEV_JWT_SECRET || "insecure-dev-secret";
  const cookie = req.headers.get("cookie") || "";
  const match = /(?:^|;\s*)session=([^;]+)/.exec(cookie);
  const token = match?.[1] ? decodeURIComponent(match[1]) : null;

  if (!token) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = verifyHS256(token, secret);
  if (!payload) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { sub, email, exp } = payload;
  return new Response(JSON.stringify({ authenticated: true, sub, email, exp }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
