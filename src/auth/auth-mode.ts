import type { AuthMode } from "./auth-provider.ts";

export function readAuthMode(value: string | undefined, fallback: AuthMode): AuthMode {
  if (
    value === "anonymous" ||
    value === "runtime-token" ||
    value === "jwt" ||
    value === "proxy" ||
    value === "hybrid"
  ) {
    return value;
  }
  return fallback;
}
