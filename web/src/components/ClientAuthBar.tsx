"use client";

import { useCallback, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";

export function ClientAuthBar() {
  const { decoded, logout, authReady, refreshing, isAuthenticated, email } = useAuth();
  const router = useRouter();
  const handleLogin = useCallback(() => {
    router.push("/login");
  }, [router]);

  const derivedEmail = email ?? ((decoded?.payload?.email as string | undefined) || null);

  return (
    <div
      data-e2e="auth-bar"
      style={{
        padding: "8px 16px",
        borderBottom: "1px solid #eee",
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <strong style={{ fontSize: 14 }}>Academia Paz &amp; Mente</strong>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {isAuthenticated ? (
          <>
            <span style={{ fontSize: 12, color: "#555" }}>
              Autenticado{derivedEmail ? ` • ${derivedEmail}` : ""}
            </span>
            {refreshing && (
              <span data-e2e="auth-refreshing" style={{ fontSize: 11, color: "#777" }}>
                Atualizando token…
              </span>
            )}
            <button
              data-e2e="auth-logout-btn"
              onClick={() => void logout()}
              style={btnStyle}
              disabled={!authReady}
            >
              Sair
            </button>
          </>
        ) : (
          <button
            data-e2e="auth-login-btn"
            onClick={handleLogin}
            style={btnPrimaryStyle}
            disabled={!authReady}
          >
            Entrar
          </button>
        )}
      </div>
    </div>
  );
}

const btnStyle: CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 6,
  cursor: "pointer",
};

const btnPrimaryStyle: CSSProperties = {
  ...btnStyle,
  background: "#0366d6",
  color: "#fff",
  border: "1px solid #0366d6",
};
