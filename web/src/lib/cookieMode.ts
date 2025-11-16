const truthy = (value?: string | null) => {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true";
};

const getEnv = () => {
  if (typeof process !== "undefined" && process.env) {
    return process.env as Record<string, string | undefined>;
  }
  return {} as Record<string, string | undefined>;
};

export function isCookieModeEnabled() {
  const env = getEnv();
  return (
    truthy(env.COOKIE_MODE) ||
    truthy(env.NEXT_PUBLIC_COOKIE_MODE) ||
    truthy(env.NEXT_PUBLIC_USE_COOKIE_MODE)
  );
}
