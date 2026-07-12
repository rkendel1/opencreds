import type { AuthRequest, IAuthProvider } from "./auth-provider.ts";
import type { Principal, PrincipalType } from "./principal.ts";

import { createHmac, timingSafeEqual } from "node:crypto";
import { AuthenticationError, readBearerToken } from "./auth-provider.ts";

interface JwtHeader {
  alg?: string;
  typ?: string;
}

interface JwtClaims {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  tenant?: string;
  tenant_id?: string;
  user_id?: string;
  workspace?: string;
  workspace_id?: string;
  principal_type?: string;
  roles?: unknown;
}

export interface JwtAuthProviderOptions {
  secret?: string;
  issuer?: string;
  audience?: string;
  required?: boolean;
}

export class JwtAuthProvider implements IAuthProvider {
  private readonly secret?: string;
  private readonly issuer?: string;
  private readonly audience?: string;
  private readonly required: boolean;

  constructor(options: JwtAuthProviderOptions = {}) {
    this.secret = options.secret;
    this.issuer = options.issuer;
    this.audience = options.audience;
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
    if (!this.secret) {
      throw new AuthenticationError(401, "unauthorized", "JWT authentication is not configured.");
    }
    return decodeAndVerifyJwt(token, {
      secret: this.secret,
      issuer: this.issuer,
      audience: this.audience,
    });
  }
}

interface DecodeJwtOptions {
  secret: string;
  issuer?: string;
  audience?: string;
}

function decodeAndVerifyJwt(token: string, options: DecodeJwtOptions): Principal {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthenticationError(401, "unauthorized", "JWT is malformed.");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJsonSegment<JwtHeader>(encodedHeader);
  const claims = parseJsonSegment<JwtClaims>(encodedPayload);
  if (header.alg !== "HS256") {
    throw new AuthenticationError(401, "unauthorized", "JWT algorithm is not supported.");
  }

  const expectedSignature = signJwtHs256(`${encodedHeader}.${encodedPayload}`, options.secret);
  const actualSignature = Buffer.from(encodedSignature, "base64url");
  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    throw new AuthenticationError(401, "unauthorized", "JWT signature is invalid.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) {
    throw new AuthenticationError(401, "unauthorized", "JWT is expired.");
  }
  if (options.issuer && claims.iss !== options.issuer) {
    throw new AuthenticationError(401, "unauthorized", "JWT issuer is invalid.");
  }
  if (options.audience && !audienceMatches(claims.aud, options.audience)) {
    throw new AuthenticationError(401, "unauthorized", "JWT audience is invalid.");
  }
  if (!claims.sub) {
    throw new AuthenticationError(401, "unauthorized", "JWT subject is missing.");
  }

  return {
    id: claims.sub,
    type: normalizePrincipalType(claims.principal_type),
    tenantId: claims.tenant ?? claims.tenant_id,
    userId: claims.user_id ?? claims.sub,
    workspaceId: claims.workspace ?? claims.workspace_id,
    roles: normalizeRoles(claims.roles),
    issuedAt: typeof claims.iat === "number" ? claims.iat : nowSeconds,
    expiresAt: claims.exp,
  };
}

function parseJsonSegment<T>(segment: string): T {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
  } catch {
    throw new AuthenticationError(401, "unauthorized", "JWT is malformed.");
  }
}

function signJwtHs256(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

function audienceMatches(audience: string | string[] | undefined, expectedAudience: string): boolean {
  if (typeof audience === "string") {
    return audience === expectedAudience;
  }
  if (Array.isArray(audience)) {
    return audience.includes(expectedAudience);
  }
  return false;
}

function normalizePrincipalType(value: string | undefined): PrincipalType {
  if (value === "service" || value === "runtime-token") {
    return value;
  }
  return "user";
}

function normalizeRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) {
    return [];
  }
  return roles.filter((role): role is string => typeof role === "string" && role.trim().length > 0);
}
