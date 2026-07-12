import type { Principal } from "./principal.ts";

export type AuthMode = "anonymous" | "runtime-token" | "jwt" | "proxy" | "hybrid";

export interface AuthRequest {
  path: string;
  method: string;
  header(name: string): string | undefined;
}

export interface IAuthProvider {
  authenticate(request: AuthRequest): Promise<Principal | undefined>;
}

export class AuthenticationError extends Error {
  readonly status: 401 | 403;
  readonly code: string;

  constructor(status: 401 | 403, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class HybridAuthProvider implements IAuthProvider {
  private readonly providers: readonly IAuthProvider[];

  constructor(providers: readonly IAuthProvider[]) {
    this.providers = providers;
  }

  async authenticate(request: AuthRequest): Promise<Principal | undefined> {
    for (const provider of this.providers) {
      const principal = await provider.authenticate(request);
      if (principal) {
        return principal;
      }
    }
    return undefined;
  }
}

export function readBearerToken(request: Pick<AuthRequest, "header">): string | undefined {
  const authorization = request.header("authorization");
  if (!authorization) {
    return undefined;
  }
  const [scheme, token] = authorization.split(/\s+/u);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return undefined;
  }
  const normalized = token.trim();
  return normalized.length > 0 ? normalized : undefined;
}
