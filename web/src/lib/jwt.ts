export type DecodedJwt = {
  raw: string;
  header: Record<string, any>;
  payload: Record<string, any>;
  exp?: number;
  iat?: number;
};

function base64UrlDecode(segment: string): string {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  if (typeof atob === "function") {
    return atob(padded);
  }
  const g: any = globalThis;
  if (g.Buffer) {
    return g.Buffer.from(padded, "base64").toString("utf8");
  }
  throw new Error("Base64 decoder not available");
}

export function decodeJwt(token: string): DecodedJwt | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const [headerB64, payloadB64] = parts;
    const header = JSON.parse(base64UrlDecode(headerB64));
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    const exp = typeof payload.exp === "number" ? payload.exp : undefined;
    const iat = typeof payload.iat === "number" ? payload.iat : undefined;
    return { raw: token, header, payload, exp, iat };
  } catch {
    return null;
  }
}

export function msUntilExpiry(decoded: DecodedJwt | null, skewSeconds = 30): number | null {
  if (!decoded?.exp) return null;
  const now = Date.now() / 1000;
  const remaining = decoded.exp - now - skewSeconds;
  return remaining > 0 ? remaining * 1000 : 0;
}
