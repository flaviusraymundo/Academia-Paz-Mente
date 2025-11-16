// netlify/functions/dev-jwt.ts
import jwt from "jsonwebtoken";
import { pool } from "../../src/server/lib/db.ts";

const allowedOrigins = [
  /^https:\/\/lifeflourishconsulting\.com$/,
  /^https:\/\/www\.lifeflourishconsulting\.com$/,
  /^https:\/\/lifeflourishconsulting\.netlify\.app$/,
  /^https:\/\/staging--lifeflourishconsulting\.netlify\.app$/,
  /^https:\/\/deploy-preview-\d+--lifeflourishconsulting\.netlify\.app$/,
];

const allowOrigin = (origin: string | undefined) => {
  if (!origin) return "";
  const ok = allowedOrigins.some((pattern) => pattern.test(origin));
  return ok ? origin : "";
};

const corsHeaders = (origin: string) => {
  const baseHeaders: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    Vary: "Origin",
  };
  if (origin) {
    baseHeaders["Access-Control-Allow-Origin"] = origin;
    baseHeaders["Access-Control-Allow-Credentials"] = "true";
  }
  return baseHeaders;
};

const truthy = (value?: string | null) => {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true";
};

const getExternalApiBase = () =>
  (process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");

const allowClientFallback = () =>
  truthy(process.env.NEXT_PUBLIC_ALLOW_CLIENT_FAKE_JWT) || truthy(process.env.ALLOW_CLIENT_FAKE_JWT);

const isProductionContext = () => {
  const ctx = process.env.CONTEXT || "";
  const vercel = process.env.VERCEL_ENV || "";
  const node = process.env.NODE_ENV || "";
  return ctx === "production" || vercel === "production" || node === "production";
};

const fetchUpstreamToken = async (search: string) => {
  const base = getExternalApiBase();
  if (!base) return null;
  const upstreamUrl = `${base}/.netlify/functions/dev-jwt${search}`;
  const upstream = await fetch(upstreamUrl, { headers: { Accept: "text/plain" }, cache: "no-store" });
  const text = await upstream.text();
  if (!upstream.ok) throw new Error(`upstream_${upstream.status}`);
  const trimmed = text.trim();
  if (!trimmed) throw new Error("upstream_empty_body");
  return trimmed;
};

const handler = async (event: any) => {
  const origin = allowOrigin(event.headers?.origin);

  if (process.env.DEV_JWT_ENABLED !== "1") {
    return { statusCode: 404, body: "Not Found" };
  }
  if (isProductionContext() && process.env.DEV_JWT_ALLOW_IN_PRODUCTION !== "1") {
    return { statusCode: 404, body: "Not Found" };
  }

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(origin),
      body: "",
    };
  }

  const search = event?.rawQuery ? `?${event.rawQuery}` : "";
  const upstreamErrors: string[] = [];

  try {
    const upstreamToken = await fetchUpstreamToken(search);
    if (upstreamToken) {
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders(origin),
          "Content-Type": "text/plain",
          "Cache-Control": "no-store",
          "X-Dev-Jwt-Source": "upstream",
        },
        body: upstreamToken,
      };
    }
  } catch (err: any) {
    upstreamErrors.push(String(err?.message || err));
  }

  const email = event.queryStringParameters?.email ?? "demo@local.test";
  const name = "Aluno Dev";

  const client = await pool.connect();
  let userId: string;
  try {
    const { rows } = await client.query(
      `insert into users(email, name) values ($1,$2)
       on conflict (email) do update set name=$2
       returning id`,
      [email, name]
    );
    userId = rows[0].id;
  } finally {
    client.release();
  }

  const secretBase = process.env.JWT_SECRET || process.env.DEV_JWT_SECRET;
  const secret = secretBase || (allowClientFallback() ? "insecure-dev-secret" : null);
  if (!secret) {
    return {
      statusCode: 502,
      headers: {
        ...corsHeaders(origin),
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({ error: "jwt_secret_missing", upstreamErrors }),
    };
  }

  const issuer = upstreamErrors.length ? "dev-jwt-local-fallback" : "dev-jwt-netlify";
  const token = jwt.sign({ email, iss: issuer, dev: true }, secret, {
    subject: String(userId),
    expiresIn: "7d",
    audience: "web",
  });

  const headers = {
    ...corsHeaders(origin),
    "Content-Type": "text/plain",
    "Cache-Control": "no-store",
    "X-Dev-Jwt-Source": "local",
  } as Record<string, string>;
  if (upstreamErrors.length) {
    headers["X-Dev-Jwt-Upstream"] = upstreamErrors.join(";");
  }

  return {
    statusCode: 200,
    headers,
    body: token,
  };
};

export { handler };
