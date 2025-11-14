import { USE_COOKIE_MODE } from "./config";

export function getApiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
}

export type ApiResponse<T = any> = { status: number; body: T | any };

export async function api<T = any>(
  path: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    jwt?: string | null;
    signal?: AbortSignal;
  } = {}
) : Promise<ApiResponse<T>> {
  const { method = "GET", headers = {}, body, jwt, signal } = opts;
  const h: Record<string, string> = { ...headers };
  const base = getApiBase();
  const url = base ? `${base}${path}` : path;

  if (!USE_COOKIE_MODE && jwt) {
    h.Authorization = `Bearer ${jwt}`;
  }
  if (body && !("Content-Type" in h)) {
    h["Content-Type"] = "application/json";
  }

  const r = await fetch(url, {
    method,
    headers: h,
    body,
    signal,
    credentials: USE_COOKIE_MODE ? "include" : "same-origin",
  });

  let data: any = null;
  try {
    data = await r.json();
  } catch {
    try {
      data = await r.text();
    } catch {
      data = null;
    }
  }

  return { status: r.status, body: data };
}

export async function apiGet<T = any>(path: string, jwt?: string | null) {
  return api<T>(path, { method: "GET", jwt });
}

export async function apiPost<T = any>(path: string, data?: any, jwt?: string | null) {
  return api<T>(path, {
    method: "POST",
    body: data ? JSON.stringify(data) : undefined,
    jwt,
  });
}

const apiDefault = Object.assign(api, { base: getApiBase, get: apiGet, post: apiPost });
export default apiDefault;
