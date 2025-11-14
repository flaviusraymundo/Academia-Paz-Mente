"use client";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { decodeJwt, msUntilExpiry } from "../lib/jwt";
import { buildDevJwt } from "../lib/devJwt";
import { USE_COOKIE_MODE, DEV_FAKE } from "../lib/config";

export type Toast = { id: string; text: string; kind: "info" | "error" | "success" };

type AuthState = {
  jwt: string | null;
  decoded: ReturnType<typeof decodeJwt>;
  ready: boolean;
  authReady: boolean;
  login: (email: string) => Promise<boolean>;
  logout: () => Promise<void> | void;
  refreshing: boolean;
  lastError: string | null;
  toasts: Toast[];
  dismissToast: (id: string) => void;
  authenticated?: boolean;
  email?: string | null;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthState | null>(null);
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthContext não disponível");
  return ctx;
};

const LS_KEY = "lms_jwt";

function addToastSetter(setToasts: React.Dispatch<React.SetStateAction<Toast[]>>) {
  return (text: string, kind: Toast["kind"] = "info") =>
    setToasts((prev) => [
      ...prev,
      {
        id:
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2),
        text,
        kind,
      },
    ]);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [jwt, setJwt] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<ReturnType<typeof decodeJwt>>(null);
  const [ready, setReady] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [authenticated, setAuthenticated] = useState<boolean | undefined>(undefined);
  const [email, setEmail] = useState<string | null>(null);
  const addToast = addToastSetter(setToasts);
  const refreshTimerRef = useRef<number | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/session", { credentials: "include" });
      const j = await r.json();
      if (j?.authenticated) {
        setAuthenticated(true);
        setEmail(j?.email || null);
      } else {
        setAuthenticated(false);
        setEmail(null);
      }
    } catch {
      setAuthenticated(false);
      setEmail(null);
    } finally {
      setAuthReady(true);
    }
  }, []);

  const scheduleRefresh = useCallback(async () => {
    if (USE_COOKIE_MODE) return;
    if (!jwt) return;
    setRefreshing(true);
    try {
      const d = decodeJwt(jwt);
      if (!d?.exp) {
        addToast("Token sem exp (DEV); nenhum refresh realizado.", "info");
        return;
      }
      addToast("Refresh stub concluído (implementar rota real).", "info");
    } catch (e: any) {
      setLastError(String(e?.message || e));
      addToast("Falha no refresh", "error");
    } finally {
      setRefreshing(false);
    }
  }, [jwt, addToast]);

  // Inicialização
  useEffect(() => {
    if (USE_COOKIE_MODE) {
      setAuthReady(false);
      void refreshSession().finally(() => {
        setReady(true);
      });
      return;
    }
    const initial = window.localStorage.getItem(LS_KEY);
    if (initial) {
      setJwt(initial);
      setDecoded(decodeJwt(initial));
    }
    setReady(true);
    setAuthReady(true);
  }, [refreshSession]);

  useEffect(() => {
    if (USE_COOKIE_MODE) return;
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (!jwt) return;
    const d = decodeJwt(jwt);
    setDecoded(d);
    const ms = msUntilExpiry(d);
    if (ms != null && ms > 0) {
      refreshTimerRef.current = window.setTimeout(() => {
        void scheduleRefresh();
      }, ms);
    }
  }, [jwt, scheduleRefresh]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  const login = useCallback(
    async (email: string) => {
      setLastError(null);
      try {
        if (!email || !/\S+@\S+\.\S+/.test(email)) {
          setLastError("Email inválido");
          addToast("Email inválido", "error");
          return false;
        }

        if (USE_COOKIE_MODE) {
          setAuthReady(false);
          const r = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
            credentials: "include",
          });
          if (!r.ok) {
            setLastError(`Login falhou (${r.status})`);
            addToast("Login falhou", "error");
            setAuthReady(true);
            return false;
          }
          await refreshSession();
          addToast("Login via cookie efetuado", "success");
          return true;
        }

        // Modo header (DEV atual)
        let token: string | null = null;

        if (DEV_FAKE) {
          const endpoints = [
            `/api/dev-jwt?email=${encodeURIComponent(email)}`,
            `/.netlify/functions/dev-jwt?email=${encodeURIComponent(email)}`,
          ];
          const errors: string[] = [];
          for (const url of endpoints) {
            try {
              const r = await fetch(url);
              if (r.ok) {
                token = await r.text();
                break;
              } else {
                errors.push(`${url} -> ${r.status}`);
              }
            } catch (e: any) {
              errors.push(`${url} -> ${String(e?.message || e)}`);
            }
          }
          if (!token) {
            const rawAllow =
              typeof process !== "undefined"
                ? (process as any).env?.NEXT_PUBLIC_ALLOW_CLIENT_FAKE_JWT
                : undefined;
            const allowClientFake = rawAllow === "1" || rawAllow === "true";

            if (allowClientFake) {
              token = await buildDevJwt(email);
              addToast("Usando dev-jwt local (fallback)", "info");
              setLastError(
                `Dev endpoints indisponíveis (${errors.join(" ; ")}); usando fallback client.`
              );
            } else {
              setLastError(`Dev endpoints indisponíveis (${errors.join(" ; ")})`);
              addToast("Dev-jwt indisponível", "error");
              return false;
            }
          }
        } else {
          const r = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          if (!r.ok) {
            setLastError(`Login falhou (${r.status})`);
            addToast("Login falhou", "error");
            return false;
          }
          const data = await r.json();
          token = data?.token || null;
        }

        if (!token) {
          addToast("Token ausente", "error");
          return false;
        }

        setJwt(token);
        window.localStorage.setItem(LS_KEY, token);
        addToast("Login efetuado", "success");
        return true;
      } catch (e: any) {
        const msg = String(e?.message || e);
        setLastError(msg);
        addToast(`Erro de rede: ${msg}`, "error");
        if (USE_COOKIE_MODE) {
          setAuthReady(true);
        }
        return false;
      }
    },
    [refreshSession, addToast]
  );

  const logout = useCallback(async () => {
    if (USE_COOKIE_MODE) {
      setAuthReady(false);
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      await refreshSession();
      addToast("Logout via cookie efetuado", "info");
      return;
    }
    setJwt(null);
    setDecoded(null);
    window.localStorage.removeItem(LS_KEY);
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    addToast("Logout efetuado", "info");
  }, [refreshSession, addToast]);

  const dismissToast = (id: string) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  };

  const isAuthenticated = USE_COOKIE_MODE ? !!authenticated : !!jwt;

  return (
    <AuthContext.Provider
      value={{
        jwt,
        decoded,
        ready,
        authReady,
        login,
        logout,
        refreshing,
        lastError,
        toasts,
        dismissToast,
        authenticated: USE_COOKIE_MODE ? !!authenticated : undefined,
        email: USE_COOKIE_MODE ? email : undefined,
        isAuthenticated,
      }}
    >
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 9999,
          maxWidth: 320,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            data-e2e="auth-toast"
            onClick={() => dismissToast(t.id)}
            style={{
              cursor: "pointer",
              padding: "8px 12px",
              borderRadius: 8,
              background:
                t.kind === "error"
                  ? "#ffefef"
                  : t.kind === "success"
                  ? "#e9f7ef"
                  : "#f3f3f6",
              border: "1px solid #ddd",
              fontSize: 13,
              boxShadow: "0 2px 4px rgba(0,0,0,0.08)",
            }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </AuthContext.Provider>
  );
}
