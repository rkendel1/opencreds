import type { IdentityContext } from "../../identity/types.ts";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export interface RuntimeTokenRecord {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastUsedAt?: string;
  /** Identity context of the token owner, if any. */
  identity?: IdentityContext;
}

export interface RuntimeTokenSummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  /** Identity context of the token owner, if any. */
  identity?: IdentityContext;
}

export interface RuntimeTokenCreation {
  token: string;
  record: RuntimeTokenRecord;
}

/**
 * Result of token verification including identity context.
 */
export interface RuntimeTokenVerification {
  verified: boolean;
  tokenId?: string;
  identity?: IdentityContext;
}

export interface IRuntimeTokenStore {
  add(record: RuntimeTokenRecord): Promise<void>;
  list(identity?: IdentityContext): Promise<RuntimeTokenRecord[]>;
  revoke(id: string, identity?: IdentityContext): Promise<boolean>;
  markUsed(id: string, usedAt: string): Promise<void>;
}

const tokenPrefix = "oct_";

export class RuntimeTokenService {
  private readonly store: IRuntimeTokenStore;

  constructor(store: IRuntimeTokenStore) {
    this.store = store;
  }

  async createToken(name: string, identity?: IdentityContext): Promise<RuntimeTokenCreation> {
    const token = `${tokenPrefix}${randomBytes(32).toString("base64url")}`;
    const now = new Date().toISOString();
    const record: RuntimeTokenRecord = {
      id: randomUUID(),
      name: name.trim(),
      tokenHash: hashRuntimeToken(token),
      createdAt: now,
      identity,
    };
    await this.store.add(record);
    return { token, record };
  }

  async listTokens(identity?: IdentityContext): Promise<RuntimeTokenSummary[]> {
    return (await this.store.list(identity)).map(summarizeRuntimeToken);
  }

  async revokeToken(id: string, identity?: IdentityContext): Promise<boolean> {
    return this.store.revoke(id, identity);
  }

  async verifyToken(token: string): Promise<boolean> {
    const result = await this.verifyTokenWithIdentity(token);
    return result.verified;
  }

  /**
   * Verify a token and return identity context if present.
   */
  async verifyTokenWithIdentity(token: string): Promise<RuntimeTokenVerification> {
    const tokenHash = hashRuntimeToken(token);
    // List all tokens (no identity filter) to allow verification across tenants
    const matched = (await this.store.list()).find((record) => equalHashes(record.tokenHash, tokenHash));
    if (!matched) {
      return { verified: false };
    }

    await this.store.markUsed(matched.id, new Date().toISOString());
    return {
      verified: true,
      tokenId: matched.id,
      identity: matched.identity,
    };
  }
}

export function hashRuntimeToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function summarizeRuntimeToken(record: RuntimeTokenRecord): RuntimeTokenSummary {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    identity: record.identity,
  };
}

function equalHashes(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
