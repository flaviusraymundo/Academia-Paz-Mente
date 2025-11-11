export type SanitizeMode = "none" | "sanitize" | "blank";

const MEDIA_KEYS = ["mux_playback_id", "mux_asset_id", "doc_id", "html", "url"];

export function sanitizePayloadRef<T = any>(ref: T, mode: SanitizeMode): T {
  if (mode === "none") return (ref ?? {}) as T;
  if (!ref || typeof ref !== "object") return {} as T;
  const clone: any = Array.isArray(ref) ? [...(ref as any[])] : { ...(ref as any) };
  for (const k of MEDIA_KEYS) {
    if (k in clone) delete clone[k];
  }
  return clone as T;
}

export function resolveMode(opts?: { blankMedia?: boolean; sanitize?: boolean }): SanitizeMode {
  if (opts?.blankMedia) return "blank";
  if (opts?.sanitize) return "sanitize";
  return "none";
}
