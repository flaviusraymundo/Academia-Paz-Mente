export const runtime = "nodejs";

// Endpoint de diagnóstico para inspecionar flags server-side
// GATED: só responde em ambientes não produção ou quando AUTH_FLAGS_ENABLED=1.
export async function GET() {
  const isProd =
    process.env.NODE_ENV === "production" ||
    process.env.CONTEXT === "production" ||
    process.env.VERCEL_ENV === "production";
  const allow = process.env.AUTH_FLAGS_ENABLED === "1";
  if (isProd && !allow) {
    return new Response("Not Found", { status: 404 });
  }

  const ctx = process.env.CONTEXT || null; // Netlify
  const nodeEnv = process.env.NODE_ENV || null;
  const cookieMode = process.env.COOKIE_MODE === "1";
  const devJwtEnabled = process.env.DEV_JWT_ENABLED === "1";
  const devJwtAllowProd = process.env.DEV_JWT_ALLOW_IN_PRODUCTION === "1";
  const jwtSecretPresent = !!process.env.JWT_SECRET;
  const devNamespace = process.env.DEV_USER_NAMESPACE_UUID || null;
  const apiBasePublic = process.env.NEXT_PUBLIC_API_BASE || null;
  const useCookieModePublic =
    process.env.NEXT_PUBLIC_USE_COOKIE_MODE === "1" ||
    process.env.NEXT_PUBLIC_USE_COOKIE_MODE === "true";
  const devFakePublic =
    process.env.NEXT_PUBLIC_DEV_FAKE === "1" ||
    process.env.NEXT_PUBLIC_DEV_FAKE === "true";

  const payload = {
    context: ctx,
    nodeEnv,
    serverCookieMode: cookieMode,
    serverDevJwtEnabled: devJwtEnabled,
    serverDevJwtAllowInProduction: devJwtAllowProd,
    jwtSecretPresent,
    devNamespace,
    publicApiBase: apiBasePublic,
    publicUseCookieMode: useCookieModePublic,
    publicDevFake: devFakePublic,
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
