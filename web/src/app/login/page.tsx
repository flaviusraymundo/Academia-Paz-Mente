"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../contexts/AuthContext";

export default function LoginPage() {
  const { login, ready, jwt, lastError, logout } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || loading) return;
    setLoading(true);
    const ok = await login(email.trim());
    setLoading(false);
    if (ok) {
      router.replace("/");
    }
  }

  return (
    <div
      style={{
        maxWidth: 420,
        margin: "40px auto",
        padding: "24px",
        border: "1px solid #eee",
        borderRadius: 12,
        background: "#fff",
        boxShadow: "0 8px 20px rgba(15,23,42,0.08)",
      }}
    >
      <h1 style={{ marginTop: 0 }}>Login</h1>
      {jwt && (
        <div style={{ marginBottom: 12, fontSize: 13, color: "#0a6" }}>
          Sessão ativa.
          <button onClick={logout} style={{ marginLeft: 8, fontSize: 12 }}>Logout</button>
        </div>
      )}
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
            transition: "background 0.2s ease",
          }}
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
        {lastError && (
          <div style={{ fontSize: 12, color: "#a00", whiteSpace: "pre-wrap" }}>{lastError}</div>
        )}
        <div style={{ fontSize: 12, color: "#555" }}>
          {process.env.NEXT_PUBLIC_DEV_FAKE === "1"
            ? "Modo DEV_FAKE: gera JWT local na função dev-jwt."
            : "Produção: espera backend /api/auth/login retornar token ou definir cookie HttpOnly."}
        </div>
      </form>
    </div>
  );
}
