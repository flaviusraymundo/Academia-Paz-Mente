"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { persistToken } from "@/src/lib/token";

export default function LoginPageContent() {
  const search = useSearchParams();
  const from = search.get("from") || "/";
  const COOKIE_MODE = process.env.NEXT_PUBLIC_COOKIE_MODE === "1";

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      if (!r.ok) {
        alert("Falha no login. Tente novamente.");
        setLoading(false);
        return;
      }
      if (!COOKIE_MODE) {
        try {
          const payload = await r.json().catch(() => ({}));
          if (payload?.token) {
            try {
              persistToken(payload.token);
            } catch {
              // noop
            }
          }
        } catch {
          // noop
        }
      }
      window.location.assign(from);
    } catch {
      alert("Erro de rede no login.");
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: "48px auto", padding: 24 }}>
      <h1>Login</h1>
      <p>Flags (client): cookieMode={String(COOKIE_MODE)}</p>
      <form onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ display: "block", width: "100%", margin: "8px 0 16px" }}
        />
        <button type="submit" disabled={loading} data-e2e="login-submit">
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}
