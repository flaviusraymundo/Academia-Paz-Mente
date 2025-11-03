// netlify/functions/dev-jwt.ts
import jwt from "jsonwebtoken";
import { pool } from "../../src/server/lib/db.ts";

export const handler = async (event: any) => {
  if (process.env.DEV_FAKE !== "1") return { statusCode: 403, body: "forbidden" };
  const params = new URLSearchParams(event.queryStringParameters || {});
  const email = params.get("email") || "demo@local.test";
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
  return { statusCode: 200, body: JSON.stringify({ token }) };
};
