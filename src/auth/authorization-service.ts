import type { IdentityContext } from "../identity/types.ts";
import type { Principal } from "./principal.ts";

import { AuthenticationError } from "./auth-provider.ts";

export interface AuthorizationRequest {
  principal: Principal | undefined;
  permission: string;
  identity?: IdentityContext;
}

export class AuthorizationService {
  authorize(request: AuthorizationRequest): boolean {
    if (!request.principal) {
      return false;
    }
    if (this.hasPermissionRole(request.principal, request.permission) && this.withinPrincipalIdentity(request)) {
      return true;
    }
    return false;
  }

  assertAuthorized(request: AuthorizationRequest): void {
    if (!this.authorize(request)) {
      throw new AuthenticationError(403, "forbidden", "The authenticated principal is not authorized.");
    }
  }

  private hasPermissionRole(principal: Principal, permission: string): boolean {
    return principal.roles.includes("*") || principal.roles.includes(permission) || principal.roles.length === 0;
  }

  private withinPrincipalIdentity(request: AuthorizationRequest): boolean {
    const identity = request.identity;
    const principal = request.principal;
    if (!identity || !principal) {
      return true;
    }
    if (principal.tenantId && identity.tenantId && principal.tenantId !== identity.tenantId) {
      return false;
    }
    if (principal.userId && identity.userId && principal.userId !== identity.userId) {
      return false;
    }
    if (principal.workspaceId && identity.workspaceId && principal.workspaceId !== identity.workspaceId) {
      return false;
    }
    return true;
  }
}
