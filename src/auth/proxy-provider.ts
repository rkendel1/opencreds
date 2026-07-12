import type { AuthRequest, IAuthProvider } from "./auth-provider.ts";
import type { Principal, PrincipalType } from "./principal.ts";

import { AuthenticationError } from "./auth-provider.ts";

export interface ProxyAuthProviderOptions {
  trustedProxy?: boolean;
  required?: boolean;
  principalIdHeader?: string;
  principalTypeHeader?: string;
  rolesHeader?: string;
  tenantHeader?: string;
  userHeader?: string;
  workspaceHeader?: string;
}

export class ProxyAuthProvider implements IAuthProvider {
  private readonly trustedProxy: boolean;
  private readonly required: boolean;
  private readonly principalIdHeader: string;
  private readonly principalTypeHeader: string;
  private readonly rolesHeader: string;
  private readonly tenantHeader: string;
  private readonly userHeader: string;
  private readonly workspaceHeader: string;

  constructor(options: ProxyAuthProviderOptions = {}) {
    this.trustedProxy = options.trustedProxy ?? false;
    this.required = options.required ?? true;
    this.principalIdHeader = options.principalIdHeader ?? "x-oc-principal-id";
    this.principalTypeHeader = options.principalTypeHeader ?? "x-oc-principal-type";
    this.rolesHeader = options.rolesHeader ?? "x-oc-roles";
    this.tenantHeader = options.tenantHeader ?? "x-tenant-id";
    this.userHeader = options.userHeader ?? "x-user-id";
    this.workspaceHeader = options.workspaceHeader ?? "x-workspace-id";
  }

  async authenticate(request: AuthRequest): Promise<Principal | undefined> {
    const principalId = request.header(this.principalIdHeader);
    const principalType = request.header(this.principalTypeHeader);
    const tenantId = request.header(this.tenantHeader);
    const userId = request.header(this.userHeader);
    const workspaceId = request.header(this.workspaceHeader);
    const hasProxyIdentityHeaders = Boolean(principalId || principalType || tenantId || userId || workspaceId);

    if (!this.trustedProxy) {
      if (hasProxyIdentityHeaders) {
        throw new AuthenticationError(401, "unauthorized", "Identity headers require trusted proxy mode.");
      }
      if (this.required) {
        throw new AuthenticationError(401, "unauthorized", "Proxy authentication is required.");
      }
      return undefined;
    }

    if (!principalId) {
      if (this.required) {
        throw new AuthenticationError(401, "unauthorized", "Trusted proxy principal header is missing.");
      }
      return undefined;
    }

    const now = Math.floor(Date.now() / 1000);
    return {
      id: principalId,
      type: normalizePrincipalType(principalType),
      tenantId: normalizeHeader(tenantId),
      userId: normalizeHeader(userId),
      workspaceId: normalizeHeader(workspaceId),
      roles: parseRoles(request.header(this.rolesHeader)),
      issuedAt: now,
      expiresAt: Number.MAX_SAFE_INTEGER,
    };
  }
}

function normalizePrincipalType(value: string | undefined): PrincipalType {
  if (value === "service" || value === "runtime-token") {
    return value;
  }
  return "user";
}

function parseRoles(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
}

function normalizeHeader(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}
