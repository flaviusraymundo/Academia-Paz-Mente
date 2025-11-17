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

const previewContexts = new Set(["deploy-preview", "branch-deploy"]);
const debugNamespace = (process.env.DEBUG || process.env.LOG_LEVEL || "").toLowerCase();
const devJwtDebugEnabled = debugNamespace.includes("dev-jwt");
const devJwtLog = (...args: any[]) => {
  if (!devJwtDebugEnabled) return;
  console.debug("[dev-jwt][netlify]", ...args);
};

const getNormalizedContext = () => (process.env.CONTEXT || process.env.VERCEL_ENV || "").toLowerCase();

const isPreviewContext = () => previewContexts.has(getNormalizedContext());

const isProductionContext = () => {
  const ctx = getNormalizedContext();
  if (ctx) return ctx === "production";
  return (process.env.NODE_ENV || "").toLowerCase() === "production";
};

const allowDevJwtInProduction = () => {
  if (process.env.DEV_JWT_ALLOW_IN_PRODUCTION === "1") return true;
  return isPreviewContext();
};

const isDevJwtEnabled = () => {
  const flag = process.env.DEV_JWT_ENABLED;
  if (flag === "1" || flag === "0") return flag === "1";
  return !isProductionContext();
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

  devJwtLog("request", {
    method: event.httpMethod,
    rawPath: event.rawUrl || event.path,
    context: getNormalizedContext() || null,
  });

  if (!isDevJwtEnabled()) {
    devJwtLog("blocked", { reason: "flag_disabled" });
    return { statusCode: 404, body: "Not Found" };
  }
  if (isProductionContext() && !allowDevJwtInProduction()) {
    devJwtLog("blocked", { reason: "production", context: getNormalizedContext() || null });
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
      const response = {
        statusCode: 200,
        headers: {
          ...corsHeaders(origin),
          "Content-Type": "text/plain",
          "Cache-Control": "no-store",
          "X-Dev-Jwt-Source": "upstream",
        },
        body: upstreamToken,
      };
      devJwtLog("issued", { source: "upstream", context: getNormalizedContext() || null });
      return response;
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

const allowFallbackSecret = () => {
  if (!isProductionContext()) return true;
  if (allowDevJwtInProduction()) return true;
  return allowClientFallback();
};

const secretBase = process.env.JWT_SECRET || process.env.DEV_JWT_SECRET;
const secret = secretBase || (allowFallbackSecret() ? "insecure-dev-secret" : null);
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

  devJwtLog("issued", { source: upstreamErrors.length ? "local-fallback" : "local" });
  return {
    statusCode: 200,
    headers,
    body: token,
  };
};

export { handler };
