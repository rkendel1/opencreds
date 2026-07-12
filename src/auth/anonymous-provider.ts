import type { AuthRequest, IAuthProvider } from "./auth-provider.ts";
import type { Principal } from "./principal.ts";

import { AuthenticationError } from "./auth-provider.ts";

export interface AnonymousAuthProviderOptions {
  enabled?: boolean;
}

export class AnonymousAuthProvider implements IAuthProvider {
  private readonly enabled: boolean;

  constructor(options: AnonymousAuthProviderOptions = {}) {
    this.enabled = options.enabled ?? true;
  }

  async authenticate(_request: AuthRequest): Promise<Principal | undefined> {
    if (!this.enabled) {
      throw new AuthenticationError(401, "unauthorized", "Anonymous authentication is disabled.");
    }
    const now = Date.now();
    return {
      id: "anonymous",
      type: "user",
      roles: ["anonymous"],
      issuedAt: now,
      expiresAt: Date.UTC(9999, 0, 1),
    };
  }
}
