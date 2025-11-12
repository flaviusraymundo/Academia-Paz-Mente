// Utilidades para chamada à API do backend.

export function getApiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
}

export async function apiGet<T>(path: string, jwt?: string): Promise<{ status: number; body: T | any }> {
  const base = getApiBase();
  const url = base ? `${base}${path}` : path;
  const headers: Record<string,string> = {};
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  let res: Response;
  try {
    res = await fetch(url, { headers, cache: "no-store" });
  } catch (e: any) {
    return { status: 0, body: { error: "fetch_failed", detail: String(e) } };
  }
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body };
}

// Interface simples para imitar uso axios-like nas páginas.
export interface Api {
  get<T>(path: string, jwt?: string): Promise<{ status: number; body: T | any }>;
  base(): string;
}

// Named export esperado pelas páginas.
export const api: Api = {
  get: apiGet,
  base: getApiBase,
};

// (Opcional) Exporte também como default se em algum lugar usarem import api from "../lib/api"
export default api;
