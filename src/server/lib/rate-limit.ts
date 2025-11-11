type Bucket = { ts: number[] };
const buckets = new Map<string, Bucket>();

export function allowRate(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key) || { ts: [] };
  // limpa janelas antigas
  bucket.ts = bucket.ts.filter(t => now - t < windowMs);
  if (bucket.ts.length >= limit) {
    buckets.set(key, bucket);
    const retryAfterMs = windowMs - (now - bucket.ts[0]);
    return { ok: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }
  bucket.ts.push(now);
  buckets.set(key, bucket);
  return { ok: true, retryAfterMs: 0 };
}
