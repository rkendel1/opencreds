/**
 * Identity context creation and manipulation utilities.
 *
 * These functions help create, validate, and serialize identity contexts
 * throughout the runtime lifecycle.
 */

import type { IdentityContext } from "./types.ts";

import { isEmptyIdentityContext, normalizeIdentityContext } from "./types.ts";

export { isEmptyIdentityContext, normalizeIdentityContext };

/**
 * Options for creating an identity context from various sources.
 */
export interface CreateIdentityContextOptions {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
}

/**
 * Create an identity context from options.
 *
 * Returns undefined if all fields are empty, otherwise returns a normalized context.
 */
export function createIdentityContext(options: CreateIdentityContextOptions): IdentityContext | undefined {
  const context: IdentityContext = normalizeIdentityContext({
    tenantId: normalizeIdentityField(options.tenantId),
    userId: normalizeIdentityField(options.userId),
    workspaceId: normalizeIdentityField(options.workspaceId),
  });

  return isEmptyIdentityContext(context) ? undefined : context;
}

/**
 * Merge two identity contexts, with the second context taking precedence.
 */
export function mergeIdentityContext(
  base: IdentityContext | undefined,
  override: IdentityContext | undefined,
): IdentityContext {
  return normalizeIdentityContext({
    tenantId: override?.tenantId ?? base?.tenantId,
    userId: override?.userId ?? base?.userId,
    workspaceId: override?.workspaceId ?? base?.workspaceId,
  });
}

/**
 * Serialize identity context to a stable string for logging or comparison.
 */
export function serializeIdentityContext(context: IdentityContext | undefined): string {
  if (isEmptyIdentityContext(context)) {
    return "anonymous";
  }
  const parts: string[] = [];
  if (context!.tenantId) {
    parts.push(`tenant:${context!.tenantId}`);
  }
  if (context!.userId) {
    parts.push(`user:${context!.userId}`);
  }
  if (context!.workspaceId) {
    parts.push(`workspace:${context!.workspaceId}`);
  }
  return parts.join("/");
}

/**
 * Normalize a single identity field, returning undefined for empty strings.
 */
function normalizeIdentityField(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
