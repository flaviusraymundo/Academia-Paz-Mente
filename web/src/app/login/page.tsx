"use client";
import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { persistToken } from "../../lib/token";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const search = useSearchParams();
  const from = search.get("from") || "/";
  const COOKIE_MODE = process.env.NEXT_PUBLIC_COOKIE_MODE === "1";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    }).catch(() => null as any);
    if (!r || !r.ok) {
      alert("Falha no login. Tente novamente.");
      return;
    }
    if (!COOKIE_MODE) {
      try {
        const payload = await r.json().catch(() => ({}));
        if (payload?.token) persistToken(payload.token);
      } catch {
        // noop
      }
    }
    window.location.assign(from);
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <button type="submit" data-e2e="login-submit">Entrar</button>
    </form>
  );
}
