const CAN_USE_LS = typeof window !== "undefined" && !!window.localStorage;

const KEYS = ["apm_token", "lms_jwt", "apm_jwt", "jwt"] as const;

export function readTokenFromStorage(): string | null {
  if (!CAN_USE_LS) return null;
  for (const k of KEYS) {
    try {
      const v = localStorage.getItem(k);
      if (v) return v;
    } catch {
      // ignore
    }
  }
  return null;
}

export function persistToken(token: string | null) {
  if (!CAN_USE_LS) return;
  if (token) {
    try {
      localStorage.setItem("apm_token", token);
    } catch {
      return;
    }
    for (const k of KEYS) {
      if (k === "apm_token") continue;
      try {
        localStorage.removeItem(k);
      } catch {
        // ignore
      }
    }
    return;
  }
  for (const k of KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  }
}

export function ensureMigrated() {
  if (!CAN_USE_LS) return;
  const v = readTokenFromStorage();
  if (v && !localStorage.getItem("apm_token")) {
    try {
      localStorage.setItem("apm_token", v);
    } catch {
      // ignore
    }
  }
}
