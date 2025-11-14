// Gera um JWT de desenvolvimento (alg: none) no CLIENTE como último fallback.
// ATENÇÃO: este token não é assinado e pode ser rejeitado pelo backend.
// Use apenas quando NEXT_PUBLIC_ALLOW_CLIENT_FAKE_JWT=1 em DEV.
// Agora o sub é um UUID v5 (SHA-1) consistente com o servidor.

function b64urlFromJSON(obj: any): string {
  const json = JSON.stringify(obj);
  // encodeURIComponent -> unescape -> btoa para lidar com UTF-8
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

// SHA-1 em JS puro (fallback quando crypto.subtle não existe)
function sha1Fallback(bytes: Uint8Array): Uint8Array {
  function rotl(n: number, b: number) {
    return ((n << b) | (n >>> (32 - b))) >>> 0;
  }
  function toUint32(n: number) {
    return n >>> 0;
  }
  const h0 = 0x67452301;
  const h1 = 0xefcdab89;
  const h2 = 0x98badcfe;
  const h3 = 0x10325476;
  const h4 = 0xc3d2e1f0;

  const withOne = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  withOne.set(bytes);
  withOne[bytes.length] = 0x80;

  const bitLen = bytes.length * 8;
  const dv = new DataView(withOne.buffer);
  dv.setUint32(withOne.length - 4, bitLen >>> 0);
  dv.setUint32(withOne.length - 8, Math.floor(bitLen / 2 ** 32));

  let a = h0;
  let b = h1;
  let c = h2;
  let d = h3;
  let e = h4;

  const w = new Uint32Array(80);
  for (let i = 0; i < withOne.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = dv.getUint32(i + j * 4);
    }
    for (let j = 16; j < 80; j++) {
      w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    }
    let A = a,
      B = b,
      C = c,
      D = d,
      E = e;
    for (let j = 0; j < 80; j++) {
      let f: number, k: number;
      if (j < 20) {
        f = (B & C) | (~B & D);
        k = 0x5a827999;
      } else if (j < 40) {
        f = B ^ C ^ D;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (B & C) | (B & D) | (C & D);
        k = 0x8f1bbcdc;
      } else {
        f = B ^ C ^ D;
        k = 0xca62c1d6;
      }
      const temp =
        (toUint32(rotl(A, 5)) + toUint32(f) + toUint32(E) + toUint32(k) + toUint32(w[j])) >>> 0;
      E = D;
      D = C;
      C = rotl(B, 30);
      B = A;
      A = temp;
    }
    a = (a + A) >>> 0;
    b = (b + B) >>> 0;
    c = (c + C) >>> 0;
    d = (d + D) >>> 0;
    e = (e + E) >>> 0;
  }
  const out = new Uint8Array(20);
  const dvOut = new DataView(out.buffer);
  dvOut.setUint32(0, a);
  dvOut.setUint32(4, b);
  dvOut.setUint32(8, c);
  dvOut.setUint32(12, d);
  dvOut.setUint32(16, e);
  return out;
}

// UUID v5 (SHA-1) com Web Crypto quando disponível, senão fallback JS.
async function uuidV5Sha1(name: string, namespace: string): Promise<string> {
  const ns = /^[0-9a-fA-F-]{36}$/.test(namespace)
    ? namespace
    : "00000000-0000-0000-0000-000000000000";
  const nsBytes = hexToBytes(ns.replace(/-/g, ""));
  const nameBytes = new TextEncoder().encode(name);
  const conc = new Uint8Array(nsBytes.length + nameBytes.length);
  conc.set(nsBytes, 0);
  conc.set(nameBytes, nsBytes.length);

  let hashBytes: Uint8Array;
  if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.digest) {
    const digest = await crypto.subtle.digest("SHA-1", conc);
    hashBytes = new Uint8Array(digest);
  } else {
    hashBytes = sha1Fallback(conc);
  }

  const bytes = hashBytes.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // versão 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  return bytesToUuid(bytes);
}

export async function buildDevJwt(email: string): Promise<string> {
  // Espelhe o namespace do servidor: use NEXT_PUBLIC_DEV_USER_NAMESPACE_UUID
  const ns =
    (typeof process !== "undefined"
      ? (process as any).env?.NEXT_PUBLIC_DEV_USER_NAMESPACE_UUID
      : undefined) || "11111111-2222-3333-4444-555555555555";

  // sub consistente com o servidor (SHA-1 UUID v5 do e-mail em lower-case)
  const userId = await uuidV5Sha1(String(email || "").toLowerCase(), ns);

  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;

  const header = { alg: "none", typ: "JWT" };
  const payload = {
    sub: userId,
    email,
    role: "dev",
    iat: now,
    exp: now + day,
    iss: "dev-jwt-client-fallback",
    aud: "web",
    dev: true,
  };

  const token = `${b64urlFromJSON(header)}.${b64urlFromJSON(payload)}.`;
  return token;
}
