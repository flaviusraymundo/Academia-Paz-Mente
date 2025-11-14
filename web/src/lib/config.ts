// Flags de runtime (client-safe quando NEXT_PUBLIC_*).
export const USE_COOKIE_MODE =
  process.env.NEXT_PUBLIC_USE_COOKIE_MODE === "1" ||
  process.env.NEXT_PUBLIC_USE_COOKIE_MODE === "true";

export const DEV_FAKE =
  process.env.NEXT_PUBLIC_DEV_FAKE === "1" ||
  process.env.NEXT_PUBLIC_DEV_FAKE === "true";
