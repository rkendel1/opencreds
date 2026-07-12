/**
 * Identity primitives for multi-tenant deployments.
 *
 * These types represent the ownership and isolation boundaries for connections,
 * runtime tokens, actions, and audit events. In single-user deployments all
 * fields remain undefined, preserving existing behavior.
 */

/**
 * Principal represents the authenticated entity performing an operation.
 *
 * This could be a user, service account, or system process. The type is
 * extensible to support different authentication sources in the future.
 */
export type PrincipalType = "user" | "service" | "system";

export interface Principal {
  /** Principal identifier unique within the tenant context. */
  id: string;
  /** Type of principal for access control decisions. */
  type: PrincipalType;
  /** Optional human-readable display name. */
  displayName?: string;
}

/**
 * Tenant represents an isolated organization or account boundary.
 *
 * All resources owned by a tenant are invisible to other tenants.
 */
export interface Tenant {
  /** Stable tenant identifier, typically a UUID or slug. */
  id: string;
  /** Optional human-readable tenant name. */
  name?: string;
}

/**
 * User represents an individual identity within a tenant.
 *
 * Users belong to exactly one tenant and can own resources like connections.
 */
export interface User {
  /** Stable user identifier unique within the tenant. */
  id: string;
  /** Optional human-readable display name or email. */
  displayName?: string;
}

/**
 * Workspace represents a logical grouping of resources within a tenant.
 *
 * Workspaces allow users to organize connections and actions into projects
 * or environments while staying within their tenant boundary.
 */
export interface Workspace {
  /** Stable workspace identifier unique within the tenant. */
  id: string;
  /** Optional human-readable workspace name. */
  name?: string;
}

/**
 * Identity context passed through runtime operations.
 *
 * When all fields are undefined the runtime behaves like a single-user
 * deployment with no isolation boundaries (backward compatible).
 *
 * When populated, storage queries and audit logs include identity metadata
 * for proper tenant/user isolation and attribution.
 */
export interface IdentityContext {
  /** Tenant boundary for the current operation. */
  tenantId?: string;
  /** User performing the operation. */
  userId?: string;
  /** Optional workspace scope within the tenant. */
  workspaceId?: string;
}

/**
 * Check whether an identity context is empty (single-user mode).
 */
export function isEmptyIdentityContext(context: IdentityContext | undefined): boolean {
  if (!context) {
    return true;
  }
  return context.tenantId === undefined && context.userId === undefined && context.workspaceId === undefined;
}

/**
 * Normalize an identity context by removing undefined fields.
 */
export function normalizeIdentityContext(context: IdentityContext | undefined): IdentityContext {
  if (!context) {
    return {};
  }
  const result: IdentityContext = {};
  if (context.tenantId !== undefined) {
    result.tenantId = context.tenantId;
  }
  if (context.userId !== undefined) {
    result.userId = context.userId;
  }
  if (context.workspaceId !== undefined) {
    result.workspaceId = context.workspaceId;
  }
  return result;
}
