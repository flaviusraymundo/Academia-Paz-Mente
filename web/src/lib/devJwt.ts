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
  iss: "dev-jwt-local-fallback";
  aud: "web";
};

function base64UrlEncode(obj: JwtHeader | JwtPayload): string {
  const json = JSON.stringify(obj);

  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  if (typeof TextEncoder !== "undefined" && typeof btoa === "function") {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(json);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  if (typeof btoa === "function") {
    // Fallback que mantém compatibilidade com browsers mais antigos.
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  throw new Error("Base64 encoder not available");
}

export function buildDevJwt(email: string): string {
  const now = Math.floor(Date.now() / 1000);

  const header: JwtHeader = { alg: "none", typ: "JWT" };
  const payload: JwtPayload = {
    sub: email,
    email,
    role: "dev",
    iat: now,
    exp: now + DAY_IN_SECONDS,
    iss: "dev-jwt-local-fallback",
    aud: "web",
  };

  return `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.dev`;
}
