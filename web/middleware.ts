import { NextResponse, type NextRequest } from "next/server";
import { isCookieModeEnabled } from "./src/lib/cookieMode";

/**
 * Middleware de proteção condicional.
 * - Só ativo em "cookie mode" (env COOKIE_MODE/NEXT_PUBLIC_COOKIE_MODE = 1).
 * - Em header mode (JWT em localStorage) apenas retorna NextResponse.next().
 *
 * Notas:
 * - Em cookie mode, a mera presença do cookie "session" não é suficiente.
 *   Validamos a sessão chamando /api/auth/session com o header Cookie original.
 * - Em falha de validação (ou erro), limpamos o cookie e redirecionamos para /login.
 */

// Rotas de páginas que exigem autenticação (quando cookie mode está ativo)
const protectedPrefixes = ["/video", "/text", "/quiz"] as const;
const LOGIN_PATH = "/login";

export async function middleware(req: NextRequest) {
  const cookieMode = isCookieModeEnabled();
  if (!cookieMode) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;

  if (pathname === LOGIN_PATH) {
    return NextResponse.next();
  }

  const needsAuth = protectedPrefixes.some((p) => pathname.startsWith(p));
  if (!needsAuth) {
    return NextResponse.next();
  }

  const hasSession = !!req.cookies.get("session")?.value;
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  try {
    const sessionUrl = new URL("/api/auth/session", req.url);
    const res = await fetch(sessionUrl.toString(), {
      method: "GET",
      headers: {
        cookie: req.headers.get("cookie") || "",
      },
      cache: "no-store",
      redirect: "manual",
    });

    const data = await res
      .json()
      .catch(() => ({ authenticated: false as const }));

    if (res.ok && data?.authenticated) {
      return NextResponse.next();
    }
  } catch {
    // silencioso: trata como sessão inválida
  }

  const url = req.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  url.searchParams.set("from", pathname);
  const resp = NextResponse.redirect(url);

  resp.cookies.set({
    name: "session",
    value: "",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 0,
  });

  return resp;
}

export const config = {
  matcher: ["/((?!_next|api/.*|favicon.ico|assets/.*).*)"],
};
