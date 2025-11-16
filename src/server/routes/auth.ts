// src/server/routes/auth.ts
import { Router, Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { pool } from "../lib/db";
import { sendMagicLinkEmail } from "../lib/mail";

const router = Router();

const COOKIE_MODE = process.env.COOKIE_MODE === "1";

const LoginReq = z.object({
  email: z.string().email(),
});

const MagicReq = z.object({
  email: z.string().email(),
  redirectUrl: z.string().url().optional(), // opcional: front que receberá o token
});
const VerifyReq = z.object({
  token: z.string().min(16),
});

const JWT_SECRET = process.env.JWT_SECRET!;
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";

router.post("/auth/login", async (req: Request, res: Response) => {
  const parsed = LoginReq.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const email = parsed.data.email.toLowerCase();

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `insert into users(email) values ($1)
       on conflict (email) do update set email = excluded.email
       returning id, email`,
      [email]
    );
    const user = rows[0];

    const token = jwt.sign({ email: user.email }, JWT_SECRET, {
      subject: String(user.id),
      expiresIn: "7d",
    });

    if (COOKIE_MODE) {
      res.cookie("session", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        maxAge: 86400_000,
      });
      return res.json({ ok: true });
    }
    return res.json({ token });
  } catch (e) {
    return res.status(500).json({ error: "login_failed" });
  } finally {
    client.release();
  }
});

router.post("/auth/magic-link", async (req: Request, res: Response) => {
  const parsed = MagicReq.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email } = parsed.data;
  const redirect = parsed.data.redirectUrl || `${APP_BASE_URL}/auth/callback`;

  const client = await pool.connect();
  try {
    await client.query("begin");
    // cria usuário se não existir
    const { rows: u } = await client.query(
      `insert into users(email) values ($1)
       on conflict (email) do update set email = excluded.email
       returning id, email`,
      [email]
    );
    const user = u[0];

    const token = crypto.randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await client.query(
      `insert into magic_link_tokens(email, user_id, token, expires_at, ip, ua)
       values ($1,$2,$3,$4,$5,$6)`,
      [email, user.id, token, expires, req.ip, req.headers["user-agent"] || null]
    );
    await client.query("commit");

    const url = new URL(redirect);
    url.searchParams.set("token", token);

    await sendMagicLinkEmail(email, url.toString());
    return res.status(204).send();
  } catch (e) {
    await client.query("rollback");
    return res.status(500).json({ error: "magic_link_failed" });
  } finally {
    client.release();
  }
});

router.post("/auth/verify", async (req: Request, res: Response) => {
  const parsed = VerifyReq.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { token } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `select id, email, user_id, expires_at, used_at
       from magic_link_tokens
       where token = $1
       for update`,
      [token]
    );
    if (rows.length === 0) {
      await client.query("rollback");
      return res.status(400).json({ error: "invalid_token" });
    }
    const row = rows[0];
    if (row.used_at) {
      await client.query("rollback");
      return res.status(400).json({ error: "token_used" });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await client.query("rollback");
      return res.status(400).json({ error: "token_expired" });
    }

    // marca como usado
    await client.query(`update magic_link_tokens set used_at = now() where id = $1`, [row.id]);

    // garante usuário
    const uid = row.user_id;
    if (!uid) {
      const { rows: u } = await client.query(
        `insert into users(email) values ($1) returning id, email`,
        [row.email]
      );
      row.user_id = u[0].id;
    }

    await client.query("commit");

    const jwtToken = jwt.sign(
      { email: row.email },
      JWT_SECRET,
      { subject: String(row.user_id), expiresIn: "7d" }
    );
    return res.json({ token: jwtToken });
  } catch (e) {
    await client.query("rollback");
    return res.status(500).json({ error: "verify_failed" });
  } finally {
    client.release();
  }
});

export default router;
