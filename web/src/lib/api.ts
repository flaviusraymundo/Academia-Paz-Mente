// Utilidades centralizadas para chamadas à API do backend.

export function getApiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
}

type ApiInit = (RequestInit & { jwt?: string }) | undefined;

export async function api<T = any>(path: string, init?: ApiInit): Promise<{ status: number; body: T | any }> {
  const base = getApiBase();
  const url = base ? `${base}${path}` : path;

  // Headers (preserva os recebidos, adiciona Authorization se houver JWT)
  const headers = new Headers(init?.headers);

  // 1) prioridade: jwt explícito via init.jwt
  if (init?.jwt) {
    headers.set("Authorization", `Bearer ${init.jwt}`);
  } else if (typeof window !== "undefined") {
    // 2) fallback client-side: localStorage
    try {
      const t = localStorage.getItem("jwt");
      if (t) headers.set("Authorization", `Bearer ${t}`);
    } catch {}
  }

  // Define Content-Type quando body é string e header não veio
  if (!headers.has("Content-Type") && typeof init?.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, cache: "no-store" });
  } catch (e: any) {
    return { status: 0, body: { error: "fetch_failed", detail: String(e) } };
  }

  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}

  return { status: res.status, body };
}

// Helpers opcionais, caso queira usar estilo "api.get" / "api.post"
export async function apiGet<T = any>(path: string, jwt?: string) {
  return api<T>(path, { method: "GET", jwt });
}
export async function apiPost<T = any>(path: string, data?: any, jwt?: string) {
  return api<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined, jwt });
}

// Default export (por conveniência)
const apiDefault = Object.assign(api, { get: apiGet, post: apiPost, base: getApiBase });
export default apiDefault;
