const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";
const COOKIE_MODE = (process.env.NEXT_PUBLIC_COOKIE_MODE ?? "0") === "1"; // header-mode por padrão

function getToken(): string | null {
  try { return localStorage.getItem("apm_token"); } catch { return null; }
}

type ApiResponse<T = any> = { status: number; body: T | any; error?: boolean };
type ApiOptions = RequestInit & { jwt?: string | null };

export async function apiFetch<T = any>(path: string, init: ApiOptions = {}): Promise<ApiResponse<T>> {
  const isAbsolute = /^https?:\/\//i.test(path);
  const url = isAbsolute ? path : `${API_BASE}${path}`;

  const { jwt, ...rest } = init;
  const headers = new Headers(rest.headers || {});
  if (!COOKIE_MODE) {
    const t = jwt ?? getToken();
    if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
  }

  const body: any = (rest as any).body;
  if (!headers.has("Content-Type") && body != null) {
    const hasURLSearchParams =
      typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams;

    if (typeof body === "string") {
      headers.set("Content-Type", "application/json");
    } else if (hasURLSearchParams) {
      headers.set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
    }
    // Para FormData/Blob/ArrayBuffer: deixar o browser definir automaticamente
  }

  const res = await fetch(url, {
    ...rest,
    // em header-mode NÃO precisamos de credentials
    credentials: COOKIE_MODE ? "include" : "omit",
    headers
  });

  // helper de erro legível
  const bodyText = await res.text().catch(() => "");
  let body: any = undefined;
  try { body = bodyText ? JSON.parse(bodyText) : undefined; } catch { body = bodyText; }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    (err as any).status = res.status;
    (err as any).body = body;
    throw err;
  }
  return { status: res.status, body };
}

export function getApiBase() {
  return API_BASE;
}

export function getUseCookieMode() {
  return COOKIE_MODE;
}

async function api<T = any>(path: string, init: ApiOptions = {}): Promise<ApiResponse<T>> {
  try {
    return await apiFetch<T>(path, init);
  } catch (err: any) {
    return {
      status: typeof err?.status === "number" ? err.status : 0,
      body: err?.body ?? err?.message ?? null,
      error: true,
    };
  }
}

export async function apiGet<T = any>(path: string, init: ApiOptions = {}) {
  return api<T>(path, { ...init, method: init.method ?? "GET" });
}

export async function apiPost<T = any>(path: string, body?: any, init: ApiOptions = {}) {
  return api<T>(path, {
    ...init,
    method: init.method ?? "POST",
    body: body ? JSON.stringify(body) : init.body,
  });
}

const apiDefault = Object.assign(api, {
  get: apiGet,
  post: apiPost,
  base: getApiBase,
  useCookieMode: getUseCookieMode,
  fetch: apiFetch,
});

export { api };
export default apiDefault;
