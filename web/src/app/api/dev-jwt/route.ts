export const runtime = "nodejs";

const DAY_IN_SECONDS = 24 * 60 * 60;

type JwtHeader = {
  alg: "none";
  typ: "JWT";
};

type JwtPayload = {
  sub: string;
  email: string;
  role: "dev";
  iat: number;
  exp: number;
  iss: "dev-jwt-local";
  aud: "web";
};

function base64UrlEncode(obj: JwtHeader | JwtPayload): string {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = url.searchParams.get("email") || "dev@example.com";
  const now = Math.floor(Date.now() / 1000);

  const header: JwtHeader = { alg: "none", typ: "JWT" };
  const payload: JwtPayload = {
    sub: email,
    email,
    role: "dev",
    iat: now,
    exp: now + DAY_IN_SECONDS,
    iss: "dev-jwt-local",
    aud: "web",
  };

  const token = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.dev`;

  return new Response(token, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
