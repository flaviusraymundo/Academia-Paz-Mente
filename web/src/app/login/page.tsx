"use client";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const COOKIE_MODE = (process.env.NEXT_PUBLIC_COOKIE_MODE ?? "0") === "1";
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

    if (COOKIE_MODE) {
      await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email })
      });
    } else {
      const r = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await r.json();
      if (!r.ok || !data?.token) throw new Error("login sem token");
      localStorage.setItem("apm_token", data.token);
    }

    const params = new URLSearchParams(window.location.search);
    const from = params.get("from") || "/";
    window.location.assign(from);
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email" />
      <button type="submit" data-e2e="login-submit">Entrar</button>
    </form>
  );
}
