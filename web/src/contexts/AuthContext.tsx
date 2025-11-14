"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { decodeJwt, msUntilExpiry, type DecodedJwt } from "../lib/jwt";

type Toast = { id: string; text: string; kind: "info" | "error" | "success" };

type AuthState = {
  jwt: string | null;
  decoded: DecodedJwt | null;
  ready: boolean;
  login: (email: string) => Promise<boolean>;
  logout: () => void;
  refreshing: boolean;
  lastError: string | null;
  toasts: Toast[];
  dismissToast: (id: string) => void;
};

const AuthContext = createContext<AuthState | null>(null);

const USE_COOKIE_MODE = false;
const LS_KEY = "lms_jwt";

function makeToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [jwt, setJwtState] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<DecodedJwt | null>(null);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const refreshTimerRef = useRef<number | null>(null);

  const addToast = useCallback(
    (text: string, kind: Toast["kind"] = "info") => {
      const id = makeToastId();
      setToasts((prev) => [...prev, { id, text, kind }]);
    },
    [setToasts]
  );

  const dismissToast = useCallback(
    (id: string) => {
      setToasts((current) => current.filter((t) => t.id !== id));
    },
    [setToasts]
  );

  const applyJwt = useCallback(
    (token: string | null) => {
      setJwtState(token);
      setDecoded(token ? decodeJwt(token) : null);
      if (USE_COOKIE_MODE) return;
      try {
        if (token) {
          window.localStorage.setItem(LS_KEY, token);
        } else {
          window.localStorage.removeItem(LS_KEY);
        }
      } catch {
        // noop
      }
    },
    [setDecoded, setJwtState]
  );

  const scheduleRefresh = useCallback(async () => {
    if (!jwt) return;
    setRefreshing(true);
    try {
      const d = decodeJwt(jwt);
      if (!d?.exp) {
        addToast("Token sem exp (DEV); nenhum refresh realizado.", "info");
        return;
      }
      // TODO: implementar chamada real para refresh
      addToast("Refresh stub concluído (implementar rota real).", "info");
    } catch (e: any) {
      setLastError(String(e?.message || e));
      addToast("Falha no refresh", "error");
    } finally {
      setRefreshing(false);
    }
  }, [addToast, jwt, setLastError, setRefreshing]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!USE_COOKIE_MODE) {
      try {
        const stored = window.localStorage.getItem(LS_KEY);
        if (stored) {
          setJwtState(stored);
          setDecoded(decodeJwt(stored));
        }
      } catch {
        // noop
      }
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || USE_COOKIE_MODE) return;
    function onStorage(event: StorageEvent) {
      if (event.key !== LS_KEY) return;
      const value = event.newValue;
      setJwtState(value);
      setDecoded(value ? decodeJwt(value) : null);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (!jwt) return;
    const d = decoded ?? decodeJwt(jwt);
    if (!d) return;
    const ms = msUntilExpiry(d);
    if (ms != null && ms > 0) {
      refreshTimerRef.current = window.setTimeout(() => {
        void scheduleRefresh();
      }, ms);
    }
  }, [decoded, jwt, scheduleRefresh]);

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
        let token: string | null = null;
        if (process.env.NEXT_PUBLIC_DEV_FAKE === "1" || process.env.NEXT_PUBLIC_DEV_FAKE === "true") {
          const r = await fetch(`/.netlify/functions/dev-jwt?email=${encodeURIComponent(email)}`);
          if (!r.ok) {
            setLastError("Falha ao obter dev-jwt");
            addToast("Falha ao obter dev-jwt", "error");
            return false;
          }
          token = await r.text();
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
          token = data?.token ?? null;
          if (!token && USE_COOKIE_MODE) {
            addToast("Login via cookie concluído", "success");
            applyJwt(null);
            return true;
          }
        }
        if (!token) {
          addToast("Token ausente na resposta", "error");
          return false;
        }
        applyJwt(token);
        addToast("Login efetuado", "success");
        return true;
      } catch (e: any) {
        const msg = String(e?.message || e);
        setLastError(msg);
        addToast(`Erro de rede: ${msg}`, "error");
        return false;
      }
    },
    [addToast, applyJwt, setLastError]
  );

  const logout = useCallback(() => {
    applyJwt(null);
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    addToast("Logout efetuado", "info");
  }, [addToast, applyJwt]);

  const value = useMemo<AuthState>(
    () => ({
      jwt,
      decoded,
      ready,
      login,
      logout,
      refreshing,
      lastError,
      toasts,
      dismissToast,
    }),
    [decoded, dismissToast, jwt, lastError, login, logout, ready, refreshing, toasts]
  );

  return (
    <AuthContext.Provider value={value}>
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

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthContext não disponível");
  return ctx;
};
