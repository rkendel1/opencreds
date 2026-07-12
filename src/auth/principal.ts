import type { IdentityContext } from "../identity/types.ts";

export type PrincipalType = "service" | "user" | "runtime-token";

export interface Principal {
  id: string;
  type: PrincipalType;
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  roles: string[];
  issuedAt: number;
  expiresAt: number;
}

export function principalIdentity(principal: Principal | undefined): IdentityContext | undefined {
  if (!principal) {
    return undefined;
  }
  if (!principal.tenantId && !principal.userId && !principal.workspaceId) {
    return undefined;
  }
  return {
    tenantId: principal.tenantId,
    userId: principal.userId,
    workspaceId: principal.workspaceId,
  };
}
