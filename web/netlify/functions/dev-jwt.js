// Função Netlify para emitir JWT DEV assinado (HS256) com sub = UUID válido.
// GATES:
//   - DEV_JWT_ENABLED=1
//   - Bloqueio forte em produção (CONTEXT='production'), salvo se DEV_JWT_ALLOW_IN_PRODUCTION=1 (opt-in explícito).
const crypto = require("crypto");

// UUID v5 determinístico (sem dependência externa)
function uuidV5(name, namespace) {
  const nsHex = (namespace || "").replace(/-/g, "");
  if (nsHex.length !== 32) {
    namespace = "00000000-0000-0000-0000-000000000000";
  }
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(name, "utf8");
  const sha1 = crypto.createHash("sha1");
  sha1.update(nsBytes);
  sha1.update(nameBytes);
  const hash = sha1.digest();
  const bytes = Buffer.from(hash.slice(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // v5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function isProductionContext() {
  const ctx = process.env.CONTEXT || ""; // Netlify
  const vercel = process.env.VERCEL_ENV || ""; // compat com Vercel
  const node = process.env.NODE_ENV || "";
  return ctx === "production" || vercel === "production" || node === "production";
}

exports.handler = async (event) => {
  if (process.env.DEV_JWT_ENABLED !== "1") {
    return { statusCode: 404, body: "Not Found" };
  }
  if (isProductionContext() && process.env.DEV_JWT_ALLOW_IN_PRODUCTION !== "1") {
    return { statusCode: 404, body: "Not Found" };
  }

  try {
    const email =
      (event && event.queryStringParameters && event.queryStringParameters.email) ||
      "dev@example.com";
    const now = Math.floor(Date.now() / 1000);
    const day = 24 * 60 * 60;

    const ns = process.env.DEV_USER_NAMESPACE_UUID || "11111111-2222-3333-4444-555555555555";
    const userId = uuidV5(String(email || "").toLowerCase(), ns);

    const header = { alg: "HS256", typ: "JWT" };
    const payload = {
      sub: userId,
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
