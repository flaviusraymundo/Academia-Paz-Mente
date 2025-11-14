"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";

/**
 * Redireciona para /login se falta JWT (modo header) ou se cookie mode não tiver sessão.
 * Retorna { jwt, ready } para condicional de render.
 */
export function useRequireAuth() {
  const { jwt, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!jwt) router.replace("/login");
  }, [ready, jwt, router]);

  return { jwt, ready } as const;
}
