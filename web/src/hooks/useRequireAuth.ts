"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";

/**
 * Redireciona para /login se não autenticado (header ou cookie mode).
 * Usa authReady para evitar redirect prematuro em cookie mode.
 */
export function useRequireAuth() {
  const { authReady, isAuthenticated, cookieMode } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authReady) return;
    if (!isAuthenticated) {
      router.replace("/login");
    }
  }, [authReady, isAuthenticated, router]);

  return { authReady, isAuthenticated, cookieMode } as const;
}
