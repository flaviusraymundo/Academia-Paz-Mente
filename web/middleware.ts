import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware de proteção condicional.
 * - Só ativo em "cookie mode" (COOKIE_MODE=1 ou NEXT_PUBLIC_USE_COOKIE_MODE=1).
 * - Em header mode (JWT em localStorage) apenas retorna NextResponse.next().
 *
 * IMPORTANTE:
 *  - Defina COOKIE_MODE=1 nas variáveis de ambiente do build/runtime quando quiser ativar.
 *  - Não use apenas NEXT_PUBLIC_USE_COOKIE_MODE para segurança; ela é pública e só serve para habilitar UI.
 */
function isCookieMode() {
  if (process.env.COOKIE_MODE === "1") return true;
  if (
    process.env.NEXT_PUBLIC_USE_COOKIE_MODE === "1" ||
    process.env.NEXT_PUBLIC_USE_COOKIE_MODE === "true"
  )
    return true;
  return false;
}

// Rotas de páginas que exigem autenticação (quando cookie mode está ativo)
const protectedPrefixes = ["/course", "/video", "/text", "/quiz"];

export function middleware(req: NextRequest) {
  const cookieMode = isCookieMode();
  if (!cookieMode) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;

  if (pathname === "/login") {
    return NextResponse.next();
  }

  const needsAuth = protectedPrefixes.some((p) => pathname.startsWith(p));
  if (!needsAuth) {
    return NextResponse.next();
  }

  const sessionCookie = req.cookies.get("session")?.value;
  if (sessionCookie) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next|api/.*|favicon.ico|assets/.*).*)"],
};
