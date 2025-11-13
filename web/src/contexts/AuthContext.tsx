"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type AuthValue = {
  jwt: string;
  ready: boolean;
  setJwt: (t: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [jwt, setJwtState] = useState("");
  const [ready, setReady] = useState(false);

  // Carrega JWT do localStorage na montagem
  useEffect(() => {
    try {
      const t = localStorage.getItem("jwt") || "";
      setJwtState(t);
    } catch {
      // noop
    } finally {
      setReady(true);
    }
  }, []);

  // Propaga alterações vindas de outras abas/janelas
  useEffect(() => {
    function onStorage(ev: StorageEvent) {
      if (ev.key === "jwt") {
        setJwtState(ev.newValue || "");
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setJwt = useCallback((next: string) => {
    const trimmed = next.trim();
    try {
      localStorage.setItem("jwt", trimmed);
    } catch {
      // noop
    }
    setJwtState(trimmed);
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem("jwt");
    } catch {
      // noop
    }
    setJwtState("");
  }, []);

  const value = useMemo<AuthValue>(() => ({ jwt, ready, setJwt, logout }), [jwt, ready, setJwt, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
