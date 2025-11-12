"use client";

const BASE = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");

export function getToken(): string | null {
  try {
    return localStorage.getItem("jwt") || null;
  } catch {
    return null;
  }
}

export async function api(path: string, init: RequestInit = {}) {
  const url = BASE ? `${BASE}${path}` : path;
  const headers = new Headers(init.headers || {});
  const tok = getToken();
  if (tok) headers.set("Authorization", `Bearer ${tok}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body };
}
