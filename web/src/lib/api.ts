import { readTokenFromStorage } from "../lib/token";
import { isCookieModeEnabled } from "./cookieMode";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";
const COOKIE_MODE = isCookieModeEnabled();

type ApiResponse<T = any> = { status: number; body: T | any; error?: boolean };
type ApiOptions = RequestInit & { jwt?: string | null };

export async function apiFetch<T = any>(path: string, init: ApiOptions = {}): Promise<ApiResponse<T>> {
  const isAbsolute = /^https?:\/\//i.test(path);
  const url = isAbsolute ? path : `${API_BASE}${path}`;

  const { jwt, ...rest } = init;
  const headers = new Headers(rest.headers || {});
  if (!COOKIE_MODE) {
    const storedToken = typeof window !== "undefined" ? readTokenFromStorage() : null;
    const token = jwt ?? storedToken;
    if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  }

  const requestBody: any = (rest as any).body;
  if (!headers.has("Content-Type") && requestBody != null) {
    const hasURLSearchParams =
      typeof URLSearchParams !== "undefined" && requestBody instanceof URLSearchParams;
    const hasFormData = typeof FormData !== "undefined" && requestBody instanceof FormData;
    const hasBlob = typeof Blob !== "undefined" && requestBody instanceof Blob;
    const hasArrayBuffer =
      typeof ArrayBuffer !== "undefined" && requestBody instanceof ArrayBuffer;

    if (typeof requestBody === "string") {
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
  let parsedBody: any = undefined;
  try { parsedBody = bodyText ? JSON.parse(bodyText) : undefined; } catch { parsedBody = bodyText; }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    (err as any).status = res.status;
    (err as any).body = parsedBody;
    throw err;
  }
  return { status: res.status, body: parsedBody };
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
