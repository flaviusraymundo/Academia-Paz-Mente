import crypto from "crypto";

/** Base64url helper */
export function b64url(input: Buffer | string) {
  const buf = input instanceof Buffer ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** UUID v5 determinístico a partir de (name, namespace) */
export function uuidV5(name: string, namespace: string): string {
  const ns = /^[0-9a-fA-F-]{36}$/.test(namespace)
    ? namespace
    : "00000000-0000-0000-0000-000000000000";
  const nsBytes = Buffer.from(ns.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(name, "utf8");
  const sha1 = crypto.createHash("sha1");
  sha1.update(nsBytes);
  sha1.update(nameBytes);
  const hash = sha1.digest(); // 20 bytes
  const bytes = Buffer.from(hash.slice(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** Assina HS256 e devolve header.payload.signature (JWT) */
export function signHS256(payload: Record<string, any>, secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerPart = b64url(JSON.stringify(header));
  const payloadPart = b64url(JSON.stringify(payload));
  const toSign = `${headerPart}.${payloadPart}`;
  const signature = b64url(crypto.createHmac("sha256", secret).update(toSign).digest());
  return `${toSign}.${signature}`;
}

/** Verifica e decodifica HS256; retorna payload ou null */
export function verifyHS256(token: string, secret: string): Record<string, any> | null {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const toSign = `${h}.${p}`;
    const expected = b64url(crypto.createHmac("sha256", secret).update(toSign).digest());
    // comparação em tempo constante
    const a = Buffer.from(s);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    let ok = 0;
    for (let i = 0; i < a.length; i++) ok |= a[i] ^ b[i];
    if (ok !== 0) return null;

    const json = Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json);
    if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
