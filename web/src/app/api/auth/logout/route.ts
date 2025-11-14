export const runtime = "nodejs";

export async function POST() {
  const headers = new Headers();
  // Limpa cookie
  headers.append(
    "Set-Cookie",
    [
      "session=;",
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
      "Secure",
    ].join("; ")
  );
  headers.append("Content-Type", "application/json");
  headers.append("Cache-Control", "no-store");
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
