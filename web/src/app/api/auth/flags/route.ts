export const runtime = "nodejs";

// Endpoint de diagnóstico para inspecionar flags server-side
// NÃO use em produção aberta (pode ser restrito por NODE_ENV se quiser)
export async function GET() {
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
