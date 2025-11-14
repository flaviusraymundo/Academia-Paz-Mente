// Função Netlify para emitir JWT DEV assinado (HS256).
// GATED: DEV_JWT_ENABLED=1 e NODE_ENV !== 'production'.
// Assina com JWT_SECRET (fallback DEV_JWT_SECRET) para compatibilidade com middleware.
const crypto = require("crypto");

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

exports.handler = async (event) => {
  const enabled = process.env.DEV_JWT_ENABLED === "1";
  const isProd = process.env.NODE_ENV === "production";
  if (!enabled || isProd) {
    return { statusCode: 404, body: "Not Found" };
  }

  try {
    const email =
      (event && event.queryStringParameters && event.queryStringParameters.email) ||
      "dev@example.com";
    const now = Math.floor(Date.now() / 1000);
    const day = 24 * 60 * 60;

    const header = { alg: "HS256", typ: "JWT" };
    const payload = {
      sub: email,
      email,
      role: "dev",
      iat: now,
      exp: now + day,
      iss: "dev-jwt-netlify",
      aud: "web",
      dev: true,
    };

    const secret =
      process.env.JWT_SECRET || process.env.DEV_JWT_SECRET || "insecure-dev-secret";

    const headerPart = b64url(JSON.stringify(header));
    const payloadPart = b64url(JSON.stringify(payload));
    const toSign = `${headerPart}.${payloadPart}`;
    const signature = b64url(crypto.createHmac("sha256", secret).update(toSign).digest());
    const token = `${toSign}.${signature}`;

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain" },
      body: token,
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: "error generating dev jwt",
    };
  }
};
