// netlify/functions/dev-jwt.ts
import crypto from "node:crypto";
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

const allowClientFallback = () =>
  truthy(process.env.NEXT_PUBLIC_ALLOW_CLIENT_FAKE_JWT) || truthy(process.env.ALLOW_CLIENT_FAKE_JWT);

const allowFallbackSecret = () => {
  if (!isProductionContext()) return true;
  if (allowDevJwtInProduction()) return true;
  return allowClientFallback();
};

const shouldUpsertUserInDb = () => {
  const want = truthy(process.env.DEV_JWT_UPSERT_DB);
  if (!want) return false;
  return Boolean(process.env.DATABASE_URL || process.env.PGHOST);
};

const makeDeterministicUserId = (email: string) => {
  const ns =
    process.env.DEV_USER_NAMESPACE_UUID || "11111111-2222-3333-4444-555555555555";
  const cleanedNs = /^[0-9a-fA-F-]{36}$/.test(ns) ? ns : "00000000-0000-0000-0000-000000000000";
  const nsBytes = Buffer.from(cleanedNs.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(email.toLowerCase(), "utf8");
  const sha1 = crypto.createHash("sha1");
  sha1.update(nsBytes);
  sha1.update(nameBytes);
  const hash = sha1.digest();
  const bytes = Buffer.from(hash.slice(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
};

const upsertUserId = async (email: string, name: string) => {
  if (!shouldUpsertUserInDb()) return null;
  let client: any = null;
  try {
    client = await pool.connect();
    const { rows } = await client.query(
      `insert into users(email, name) values ($1,$2)
       on conflict (email) do update set name=$2
       returning id`,
      [email, name]
    );
    return rows?.[0]?.id ?? null;
  } catch (err: any) {
    devJwtLog("db_error", { error: err?.message || String(err) });
    return null;
  } finally {
    if (client) client.release();
  }
};

const getExternalApiBase = () =>
  (process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");

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

  let userId = makeDeterministicUserId(email);
  const dbUserId = await upsertUserId(email, name);
  if (dbUserId) userId = dbUserId;

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
