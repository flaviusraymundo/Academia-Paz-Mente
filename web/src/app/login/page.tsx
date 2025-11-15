"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useRouter, useSearchParams } from "next/navigation";
import { DEV_FAKE } from "../../lib/config";

function LoginPageInner() {
  const {
    login,
    authReady,
    lastError,
    logout,
    email,
    isAuthenticated,
    cookieMode,
    flags,
  } = useAuth();

  const [inputEmail, setInputEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [diag, setDiag] = useState<{
    cookieLogin?: number;
    devJwtApi?: number;
    devJwtFn?: number;
  } | null>(null);
  const router = useRouter();
  const qs = useSearchParams();
  const from = qs.get("from") || "/";

  const DEBUG =
    process.env.NEXT_PUBLIC_DEBUG === "1" || process.env.NEXT_PUBLIC_DEBUG === "true";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!authReady) return;
    setLoading(true);
    const ok = await login(inputEmail.trim());
    setLoading(false);
    if (ok) router.replace(from);
  }

  const hasSession = isAuthenticated;

  useEffect(() => {
    if (!DEBUG) return;
    let canceled = false;

    (async () => {
      const out: { cookieLogin?: number; devJwtApi?: number; devJwtFn?: number } = {};
      try {
        const r = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "" }),
          credentials: "include",
        });
        out.cookieLogin = r.status;
      } catch {
        out.cookieLogin = -1;
      }

      if (DEV_FAKE) {
        try {
          const r1 = await fetch(`/api/dev-jwt?email=diag@example.com`);
          out.devJwtApi = r1.status;
        } catch {
          out.devJwtApi = -1;
        }
        try {
          const r2 = await fetch(`/.netlify/functions/dev-jwt?email=diag@example.com`);
          out.devJwtFn = r2.status;
        } catch {
          out.devJwtFn = -1;
        }
      }

      if (!canceled) setDiag(out);
    })();

    return () => {
      canceled = true;
    };
  }, [DEBUG, DEV_FAKE]);

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: "24px", border: "1px solid #eee", borderRadius: 12 }}>
      <h1 style={{ marginTop: 0 }}>Login</h1>

      {hasSession && (
        <div style={{ marginBottom: 12, fontSize: 13, color: "#0a6" }}>
          Sessão ativa {cookieMode ? (email ? `(${email})` : "") : ""}.
          <button onClick={() => void logout()} style={{ marginLeft: 8 }}>Logout</button>
        </div>
      )}

      {DEBUG && (
        <div style={{ fontSize: 12, color: "#444", marginBottom: 12 }} data-e2e="login-debug">
          <div>
            <strong>Flags (client):</strong> cookieMode={String(cookieMode)} devFake={String(DEV_FAKE)}
          </div>
          {diag && (
            <div style={{ marginTop: 6, lineHeight: 1.5 }}>
              <div>/api/auth/login status: {diag.cookieLogin}</div>
              {DEV_FAKE && (
                <>
                  <div>/api/dev-jwt status: {diag.devJwtApi}</div>
                  <div>/.netlify/functions/dev-jwt status: {diag.devJwtFn}</div>
                </>
              )}
              <div style={{ color: "#666" }}>
                404 indica endpoint desligado; -1 indica erro de rede.
              </div>
            </div>
          )}
          {flags && (
            <div
              style={{
                background: "#fafafa",
                border: "1px solid #ddd",
                padding: "8px 10px",
                borderRadius: 8,
                fontSize: 11,
                marginTop: 8,
                lineHeight: 1.4,
                maxHeight: 220,
                overflow: "auto",
              }}
            >
              <strong>Server Flags</strong>
              <pre
                style={{
                  margin: "6px 0 0",
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                }}
              >
                {JSON.stringify(flags, null, 2)}
              </pre>
            </div>
          )}
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
          disabled={loading || !authReady}
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
          {cookieMode
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
