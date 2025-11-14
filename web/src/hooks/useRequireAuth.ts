"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";

/**
 * Redireciona para /login quando a sessão não está autenticada.
 * Exponibiliza jwt (modo header), authReady e isAuthenticated para o consumidor.
 */
export function useRequireAuth() {
  const { jwt, authReady, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authReady) return;
    if (!isAuthenticated) {
      router.replace("/login");
    }
  }, [authReady, isAuthenticated, router]);

  return { jwt, authReady, isAuthenticated } as const;
}
