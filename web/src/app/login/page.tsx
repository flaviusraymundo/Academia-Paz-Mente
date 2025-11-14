"use client";
import { Suspense, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useRouter, useSearchParams } from "next/navigation";
import { USE_COOKIE_MODE, DEV_FAKE } from "../../lib/config";

function LoginPageInner() {
  const { login, ready, jwt, lastError, logout, authenticated, email } = useAuth();
  const [inputEmail, setInputEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const qs = useSearchParams();
  const from = qs.get("from") || "/";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setLoading(true);
    const ok = await login(inputEmail.trim());
    setLoading(false);
    if (ok) router.replace(from);
  }

  const hasSession = USE_COOKIE_MODE ? authenticated : !!jwt;

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: "24px", border: "1px solid #eee", borderRadius: 12 }}>
      <h1 style={{ marginTop: 0 }}>Login</h1>

      {hasSession && (
        <div style={{ marginBottom: 12, fontSize: 13, color: "#0a6" }}>
          Sessão ativa {USE_COOKIE_MODE ? (email ? `(${email})` : "") : ""}.
          <button onClick={() => void logout()} style={{ marginLeft: 8 }}>Logout</button>
        </div>
      )}

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>Email</span>
          <input
            type="email"
            value={inputEmail}
            onChange={(e) => setInputEmail(e.target.value)}
            required
            placeholder="seu@email"
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #ccc",
              fontSize: 14,
            }}
          />
        </label>
        <button
          type="submit"
          disabled={loading || !ready}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: !loading ? "var(--color-primary,#3758f9)" : "#999",
            color: "#fff",
            border: "none",
            fontSize: 15,
            cursor: loading ? "not-allowed" : "pointer",
          }}
          data-e2e="login-submit"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>

        {lastError && (
          <div style={{ fontSize: 12, color: "#a00", whiteSpace: "pre-wrap" }}>{lastError}</div>
        )}

        <div style={{ fontSize: 12, color: "#555" }}>
          {USE_COOKIE_MODE
            ? "Modo cookie: o servidor emite um cookie HttpOnly 'session'."
            : DEV_FAKE
            ? "Modo DEV_FAKE: usa dev-jwt (servidor ou fallback local)."
            : "Modo header: aguarda backend /api/auth/login retornar token em JSON."}
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}
