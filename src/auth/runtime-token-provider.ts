import type { RuntimeTokenService } from "../server/storage/runtime-token-service.ts";
import type { AuthRequest, IAuthProvider } from "./auth-provider.ts";
import type { Principal } from "./principal.ts";

import { AuthenticationError, readBearerToken } from "./auth-provider.ts";

export interface RuntimeTokenAuthProviderOptions {
  tokens: RuntimeTokenService;
  required?: boolean;
}

export class RuntimeTokenAuthProvider implements IAuthProvider {
  private readonly tokens: RuntimeTokenService;
  private readonly required: boolean;

  constructor(options: RuntimeTokenAuthProviderOptions) {
    this.tokens = options.tokens;
    this.required = options.required ?? true;
  }

  async authenticate(request: AuthRequest): Promise<Principal | undefined> {
    const token = readBearerToken(request);
    if (!token) {
      if (!this.required) {
        return undefined;
      }
      throw new AuthenticationError(401, "unauthorized", "Authorization token is required.");
    }

    const verification = await this.tokens.verifyTokenWithIdentity(token);
    if (!verification.verified) {
      throw new AuthenticationError(401, "unauthorized", "Runtime token is invalid or revoked.");
    }

    const now = Date.now();
    return {
      id: verification.tokenId ?? "runtime-token",
      type: "runtime-token",
      tenantId: verification.identity?.tenantId,
      userId: verification.identity?.userId,
      workspaceId: verification.identity?.workspaceId,
      roles: ["runtime-token"],
      issuedAt: now,
      expiresAt: Number.MAX_SAFE_INTEGER,
    };
  }
}
