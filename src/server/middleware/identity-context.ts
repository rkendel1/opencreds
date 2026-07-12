/**
 * Hono middleware for extracting identity context from requests.
 *
 * This middleware populates the Hono context with identity information
 * extracted from request headers or JWT tokens.
 */

import type { IIdentityProvider } from "../../identity/identity-provider.ts";
import type { IdentityContext } from "../../identity/types.ts";
import type { Context, MiddlewareHandler } from "hono";

import { HeaderIdentityProvider } from "../../identity/identity-provider.ts";

const identityContextKey = "identityContext";

/**
 * Options for the identity context middleware.
 */
export interface IdentityContextMiddlewareOptions {
  /** Identity provider to resolve context from requests. */
  provider?: IIdentityProvider;
}

/**
 * Create middleware that extracts identity context from requests.
 *
 * By default uses HeaderIdentityProvider which reads from X-Tenant-ID,
 * X-User-ID, and X-Workspace-ID headers.
 */
export function createIdentityContextMiddleware(options?: IdentityContextMiddlewareOptions): MiddlewareHandler {
  const provider = options?.provider ?? new HeaderIdentityProvider();

  return async (context, next) => {
    const identity = await provider.resolveIdentity({
      header: (name: string) => context.req.header(name),
    });

    context.set(identityContextKey, identity);
    await next();
  };
}

/**
 * Read identity context from Hono context.
 *
 * Returns undefined if no identity context is present (single-user mode).
 */
export function readIdentityContext(context: Context): IdentityContext | undefined {
  return context.get(identityContextKey) as IdentityContext | undefined;
}
