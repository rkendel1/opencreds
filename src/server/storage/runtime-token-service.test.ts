import type { IdentityContext } from "../../identity/types.ts";

import { describe, expect, it } from "vitest";
import { RuntimeTokenService } from "./runtime-token-service.ts";

describe("RuntimeTokenService", () => {
  it("creates service tokens with ocs_ prefix", async () => {
    const service = new RuntimeTokenService(new MemoryRuntimeTokenStore());
    const created = await service.createServiceToken("svc");
    expect(created.token).toMatch(/^ocs_/);
  });
});

class MemoryRuntimeTokenStore {
  private readonly records: {
    id: string;
    name: string;
    tokenHash: string;
    createdAt: string;
    lastUsedAt?: string;
    identity?: IdentityContext;
  }[] = [];

  async add(record: {
    id: string;
    name: string;
    tokenHash: string;
    createdAt: string;
    lastUsedAt?: string;
    identity?: IdentityContext;
  }): Promise<void> {
    this.records.push(record);
  }

  async list(identity?: IdentityContext): Promise<typeof this.records> {
    if (!identity) {
      return [...this.records];
    }
    return this.records.filter(
      (record) =>
        record.identity?.tenantId === identity.tenantId &&
        record.identity?.userId === identity.userId &&
        record.identity?.workspaceId === identity.workspaceId,
    );
  }

  async revoke(id: string): Promise<boolean> {
    const index = this.records.findIndex((record) => record.id === id);
    if (index < 0) {
      return false;
    }
    this.records.splice(index, 1);
    return true;
  }

  async markUsed(id: string, usedAt: string): Promise<void> {
    const record = this.records.find((candidate) => candidate.id === id);
    if (record) {
      record.lastUsedAt = usedAt;
    }
  }
}
