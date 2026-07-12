/**
 * Identity provider abstraction for future authentication backends.
 *
 * The identity provider resolves identity context from request headers,
 * JWT tokens, or other authentication mechanisms. In single-user deployments
 * the default provider returns an empty context.
 */

import type { IdentityContext } from "./types.ts";

import { createIdentityContext } from "./identity-context.ts";

/**
 * Request-like object that the identity provider can read headers from.
 */
export interface IdentityRequest {
  header(name: string): string | undefined;
}

/**
 * Identity provider resolves identity context from incoming requests.
 */
export interface IIdentityProvider {
  /**
   * Extract identity context from request headers or tokens.
   *
   * Returns undefined for anonymous/single-user requests.
   */
  resolveIdentity(request: IdentityRequest): Promise<IdentityContext | undefined>;
}

/**
 * Default identity provider that reads identity from request headers.
 *
 * Supports the following headers:
 * - X-Tenant-ID: tenant identifier
 * - X-User-ID: user identifier
 * - X-Workspace-ID: workspace identifier
 *
 * This provider is suitable for trusted internal requests where identity
 * has already been validated by an upstream auth gateway.
 */
export class HeaderIdentityProvider implements IIdentityProvider {
  private readonly tenantHeader: string;
  private readonly userHeader: string;
  private readonly workspaceHeader: string;

  constructor(options?: { tenantHeader?: string; userHeader?: string; workspaceHeader?: string }) {
    this.tenantHeader = options?.tenantHeader ?? "x-tenant-id";
    this.userHeader = options?.userHeader ?? "x-user-id";
    this.workspaceHeader = options?.workspaceHeader ?? "x-workspace-id";
  }

  async resolveIdentity(request: IdentityRequest): Promise<IdentityContext | undefined> {
    return createIdentityContext({
      tenantId: request.header(this.tenantHeader),
      userId: request.header(this.userHeader),
      workspaceId: request.header(this.workspaceHeader),
    });
  }
}

/**
 * No-op identity provider for single-user deployments.
 *
 * Always returns undefined, maintaining backward compatibility with
 * existing single-user behavior.
 */
export class AnonymousIdentityProvider implements IIdentityProvider {
  async resolveIdentity(_request: IdentityRequest): Promise<IdentityContext | undefined> {
    return undefined;
  }
}
