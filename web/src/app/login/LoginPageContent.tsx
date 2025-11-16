"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";

export default function LoginPageContent() {
  const search = useSearchParams();
  const from = search.get("from") || "/";
  const { login, lastError, cookieMode, authReady, isAuthenticated } = useAuth();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email || loading) return;
    setLoading(true);
    try {
      const ok = await login(email);
      if (ok) {
        window.location.assign(from);
        return;
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: "48px auto", padding: 24 }}>
      <h1>Login</h1>
      <p>
        Flags (client): cookieMode={String(cookieMode)} • authReady={String(authReady)}
      </p>
      {isAuthenticated && (
        <p style={{ fontSize: 13, color: "#0a7d39" }} data-e2e="login-already-authed">
          Você já está autenticado.
        </p>
      )}
      {lastError && (
        <p style={{ color: "#a00", fontSize: 13 }} data-e2e="login-error">
          {lastError}
        </p>
      )}
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
        <button
          type="submit"
          disabled={loading || !authReady}
          data-e2e="login-submit"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}
