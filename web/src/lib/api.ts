// Utilidades centralizadas para chamadas à API do backend.

export function getApiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
}

// Lê cookie mode da env pública
function getUseCookieMode(): boolean {
  const v = String(process.env.NEXT_PUBLIC_USE_COOKIE_MODE || "").toLowerCase();
  return v === "1" || v === "true";
}

type ApiOptions = (RequestInit & { jwt?: string | null }) | undefined;

export async function api<T = any>(
  path: string,
  init?: ApiOptions
): Promise<{ status: number; body: T | any }> {
  const base = getApiBase();
  const url = base ? `${base}${path}` : path;

  const { jwt, headers, body, cache, ...rest } = init || {};
  const h = new Headers(headers);

  const USE_COOKIE_MODE = getUseCookieMode();
  // Em cookie mode, a sessão vai via cookie HttpOnly; não envie Authorization
  if (jwt && !USE_COOKIE_MODE) {
    h.set("Authorization", `Bearer ${jwt}`);
  }

  if (typeof body === "string" && !h.has("Content-Type")) {
    h.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: h,
      body,
      credentials: USE_COOKIE_MODE ? "include" : "same-origin",
      cache: cache ?? "no-store",
    });
  } catch (e: any) {
    return { status: 0, body: { error: "fetch_failed", detail: String(e), path: url } };
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    try {
      data = await res.text();
    } catch {
      data = null;
    }
  }

  return { status: res.status, body: data };
}

export async function apiGet<T = any>(path: string, jwt?: string | null) {
  return api<T>(path, { method: "GET", jwt });
}

export async function apiPost<T = any>(path: string, data?: any, jwt?: string | null) {
  return api<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined, jwt });
}

const apiDefault = Object.assign(api, { get: apiGet, post: apiPost, base: getApiBase });
export default apiDefault;
