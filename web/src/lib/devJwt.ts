const DEFAULT_SECRET = "insecure-dev-secret";
const DEFAULT_NAMESPACE = "11111111-2222-3333-4444-555555555555";

function textEncoder() {
  if (typeof TextEncoder !== "undefined") return new TextEncoder();
  const g: any = globalThis as any;
  if (g && typeof g.TextEncoder === "function") return new g.TextEncoder();
  throw new Error("TextEncoder not available");
}

function toUint8Array(input: string): Uint8Array {
  return textEncoder().encode(input);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const len = clean.length;
  const bytes = new Uint8Array(len / 2);
  for (let i = 0; i < len; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function rightRotate(x: number, n: number) {
  return (x >>> n) | (x << (32 - n));
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(message: Uint8Array): Uint8Array {
  const length = message.length;
  const bitLength = length * 8;
  const withOne = new Uint8Array(length + 1);
  withOne.set(message);
  withOne[length] = 0x80;

  let paddedLength = withOne.length;
  while ((paddedLength + 8) % 64 !== 0) paddedLength++;
  const padded = new Uint8Array(paddedLength + 8);
  padded.set(withOne);
  const view = new DataView(padded.buffer);
  const bigLength = BigInt(bitLength);
  view.setBigUint64(padded.length - 8, bigLength);

  const h = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ]);

  const w = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      const j = i + t * 4;
      w[t] =
        (padded[j] << 24) |
        (padded[j + 1] << 16) |
        (padded[j + 2] << 8) |
        padded[j + 3];
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rightRotate(w[t - 15], 7) ^ rightRotate(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rightRotate(w[t - 2], 17) ^ rightRotate(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hVal] = h;

    for (let t = 0; t < 64; t++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hVal + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      hVal = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hVal) >>> 0;
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = h[i] >>> 24;
    out[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff;
    out[i * 4 + 3] = h[i] & 0xff;
  }
  return out;
}

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  if (key.length > blockSize) {
    key = sha256(key);
  }
  if (key.length < blockSize) {
    const padded = new Uint8Array(blockSize);
    padded.set(key);
    key = padded;
  }

  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    const byte = key[i];
    oKeyPad[i] = byte ^ 0x5c;
    iKeyPad[i] = byte ^ 0x36;
  }

  const inner = sha256(concatBytes(iKeyPad, message));
  return sha256(concatBytes(oKeyPad, inner));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let base64: string;
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  } else if (typeof Buffer !== "undefined") {
    base64 = Buffer.from(bytes).toString("base64");
  } else {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = globalThis.btoa ? globalThis.btoa(binary) : binary;
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function uuidFromHash(hash: Uint8Array): string {
  const bytes = hash.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function uuidV5Like(name: string, namespace: string): string {
  const ns = /^[0-9a-fA-F-]{36}$/.test(namespace) ? namespace : DEFAULT_NAMESPACE;
  const nsBytes = hexToBytes(ns.replace(/-/g, ""));
  const nameBytes = toUint8Array(name.toLowerCase());
  const hash = sha256(concatBytes(nsBytes, nameBytes));
  return uuidFromHash(hash);
}

export function buildDevJwt(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;
  const namespace = process.env.NEXT_PUBLIC_DEV_USER_NAMESPACE_UUID || DEFAULT_NAMESPACE;
  const secret =
    process.env.NEXT_PUBLIC_JWT_SECRET ||
    process.env.NEXT_PUBLIC_DEV_JWT_SECRET ||
    DEFAULT_SECRET;

  const sub = uuidV5Like(email, namespace);
  const headerJson = JSON.stringify({ alg: "HS256", typ: "JWT" });
  const payloadJson = JSON.stringify({
    sub,
    email,
    role: "dev",
    iat: now,
    exp: now + day,
    iss: "dev-jwt-browser",
    aud: "web",
    dev: true,
  });

  const headerPart = bytesToBase64Url(toUint8Array(headerJson));
  const payloadPart = bytesToBase64Url(toUint8Array(payloadJson));
  const toSign = toUint8Array(`${headerPart}.${payloadPart}`);
  const signatureBytes = hmacSha256(toUint8Array(secret), toSign);
  const signaturePart = bytesToBase64Url(signatureBytes);
  return `${headerPart}.${payloadPart}.${signaturePart}`;
}
