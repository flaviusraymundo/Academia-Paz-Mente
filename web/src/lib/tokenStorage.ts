const TOKEN_KEYS = ["apm_token", "lms_jwt", "apm_jwt", "jwt"] as const;
export const TOKEN_STORAGE_KEYS: string[] = [...TOKEN_KEYS];

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readTokenFromStorage(): string | null {
  const storage = getStorage();
  if (!storage) return null;
  for (const key of TOKEN_KEYS) {
    try {
      const value = storage.getItem(key);
      if (value) return value;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function writeTokenToStorage(token: string) {
  const storage = getStorage();
  if (!storage) return;
  for (const key of TOKEN_KEYS) {
    try {
      storage.setItem(key, token);
    } catch {
      /* ignore */
    }
  }
}

export function clearStoredToken() {
  const storage = getStorage();
  if (!storage) return;
  for (const key of TOKEN_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
