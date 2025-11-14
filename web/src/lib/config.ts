// Flags de runtime (client-safe quando NEXT_PUBLIC_*).
import { getUseCookieMode } from "./api";

export const USE_COOKIE_MODE = getUseCookieMode();

export const DEV_FAKE =
  process.env.NEXT_PUBLIC_DEV_FAKE === "1" ||
  process.env.NEXT_PUBLIC_DEV_FAKE === "true";
