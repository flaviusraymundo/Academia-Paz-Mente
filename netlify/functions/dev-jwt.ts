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

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  Vary: "Origin",
  "Content-Security-Policy":
    "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
  "Content-Type": "application/json; charset=utf-8",
});

const handler = async (event: any) => {
  const origin = allowOrigin(event.headers?.origin);

  if (process.env.DEV_FAKE !== "1") {
    return {
      statusCode: 403,
      headers: corsHeaders(origin),
      body: "forbidden",
    };
  }

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(origin),
      body: "",
    };
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

  const secret = process.env.JWT_SECRET!;
  const token = jwt.sign({ email }, secret, { subject: String(userId), expiresIn: "7d" });
  return {
    statusCode: 200,
    headers: corsHeaders(origin),
    body: JSON.stringify({ token }),
  };
};

export { handler };
