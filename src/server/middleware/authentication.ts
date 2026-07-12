import type { IAuthProvider } from "../../auth/auth-provider.ts";
import type { Principal } from "../../auth/principal.ts";
import type { IdentityContext } from "../../identity/types.ts";
import type { Context, MiddlewareHandler } from "hono";

import { AuthenticationError } from "../../auth/auth-provider.ts";
import { IdentityResolver } from "../../auth/identity-resolver.ts";
import { jsonError } from "../api/http-utils.ts";

const principalContextKey = "principal";
const identityContextKey = "identityContext";

export interface AuthenticationMiddlewareOptions {
  provider: IAuthProvider;
  identityResolver?: IdentityResolver;
  shouldAuthenticate?(context: Context): boolean;
}

export function createAuthenticationMiddleware(options: AuthenticationMiddlewareOptions): MiddlewareHandler {
  const resolver = options.identityResolver ?? new IdentityResolver();
  return async (context, next) => {
    if (options.shouldAuthenticate && !options.shouldAuthenticate(context)) {
      await next();
      return;
    }
    try {
      const principal = await options.provider.authenticate({
        path: context.req.path,
        method: context.req.method,
        header: (name) => context.req.header(name),
      });
      const identity = resolver.resolve(principal);
      context.set(principalContextKey, principal);
      context.set(identityContextKey, identity);
      await next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        if (error.status === 403) {
          return context.json(
            {
              error: {
                code: error.code,
                message: error.message,
              },
            },
            403,
          );
        }
        return jsonError(context, 401, error.code, error.message);
      }
      throw error;
    }
  };
}

export function readPrincipal(context: Context): Principal | undefined {
  return context.get(principalContextKey) as Principal | undefined;
}

export function readIdentityContext(context: Context): IdentityContext | undefined {
  return context.get(identityContextKey) as IdentityContext | undefined;
}
