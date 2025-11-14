import { USE_COOKIE_MODE } from "./config";

export function getApiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
}

export type ApiResponse<T = any> = { status: number; body: T | any };

type ApiOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  jwt?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * Helper de chamadas HTTP com timeout configurável.
 * Retorna sempre { status, body } e normaliza erros de rede.
 */
export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<ApiResponse<T>> {
  const { method = "GET", headers = {}, body, jwt, signal, timeoutMs } = opts;
  const h: Record<string, string> = { ...headers };
  const base = getApiBase();
  const url = base ? `${base}${path}` : path;

  const envTimeout =
    typeof window !== "undefined"
      ? Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS)
      : Number(process.env.API_TIMEOUT_MS);

  const effectiveTimeout =
    timeoutMs ??
    (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 30000);

  if (!USE_COOKIE_MODE && jwt) {
    h.Authorization = `Bearer ${jwt}`;
  }
  if (body && !("Content-Type" in h)) {
    h["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const abortListener = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abortListener, { once: true });
    }
  }
  const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const response = await fetch(url, {
      method,
      headers: h,
      body,
      signal: controller.signal,
      credentials: USE_COOKIE_MODE ? "include" : "same-origin",
    });
    clearTimeout(timeout);
    if (signal) {
      signal.removeEventListener("abort", abortListener);
    }

    let data: any = null;
    try {
      data = await response.json();
    } catch {
      try {
        data = await response.text();
      } catch {
        data = null;
      }
    }

    return { status: response.status, body: data };
  } catch (e: any) {
    clearTimeout(timeout);
    if (signal) {
      signal.removeEventListener("abort", abortListener);
    }
    return {
      status: 0,
      body: {
        error: String(e?.message || e),
        path,
        aborted: controller.signal.aborted,
      },
    };
  }
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
