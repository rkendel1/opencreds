import type { IdentityContext } from "../identity/types.ts";
import type { Principal } from "./principal.ts";

import { createIdentityContext } from "../identity/identity-context.ts";
import { AuthenticationError } from "./auth-provider.ts";

export class IdentityResolver {
  resolve(principal: Principal | undefined): IdentityContext | undefined {
    if (!principal) {
      return undefined;
    }
    if (principal.workspaceId && (!principal.userId || !principal.tenantId)) {
      throw new AuthenticationError(401, "unauthorized", "Workspace identity requires tenant and user.");
    }
    if (principal.userId && !principal.tenantId) {
      throw new AuthenticationError(401, "unauthorized", "User identity requires tenant.");
    }
    return createIdentityContext({
      tenantId: principal.tenantId,
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    });
  }
}
