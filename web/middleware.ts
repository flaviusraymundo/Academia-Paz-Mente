import { NextResponse, NextRequest } from "next/server";

// Páginas protegidas por sessão (cookie "session")
const protectedPrefixes = ["/course", "/video", "/text", "/quiz"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const needsAuth = protectedPrefixes.some((p) => pathname.startsWith(p));
  if (!needsAuth) return NextResponse.next();

  const hasSession = req.cookies.get("session")?.value;
  if (hasSession) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next|api/.*|favicon.ico|assets/.*).*)"],
};
