import { describe, expect, it } from "vitest";
import { AnonymousIdentityProvider, HeaderIdentityProvider } from "./identity-provider.ts";

describe("identity providers", () => {
  describe("HeaderIdentityProvider", () => {
    it("extracts identity from headers", async () => {
      const provider = new HeaderIdentityProvider();
      const request = createMockRequest({
        "x-tenant-id": "tenant_123",
        "x-user-id": "user_456",
        "x-workspace-id": "workspace_789",
      });

      const identity = await provider.resolveIdentity(request);

      expect(identity).toEqual({
        tenantId: "tenant_123",
        userId: "user_456",
        workspaceId: "workspace_789",
      });
    });

    it("returns undefined when no headers present", async () => {
      const provider = new HeaderIdentityProvider();
      const request = createMockRequest({});

      const identity = await provider.resolveIdentity(request);

      expect(identity).toBeUndefined();
    });

    it("handles partial headers", async () => {
      const provider = new HeaderIdentityProvider();
      const request = createMockRequest({
        "x-tenant-id": "tenant_123",
      });

      const identity = await provider.resolveIdentity(request);

      expect(identity).toEqual({
        tenantId: "tenant_123",
      });
    });

    it("supports custom header names", async () => {
      const provider = new HeaderIdentityProvider({
        tenantHeader: "x-custom-tenant",
        userHeader: "x-custom-user",
      });
      const request = createMockRequest({
        "x-custom-tenant": "tenant_abc",
        "x-custom-user": "user_def",
      });

      const identity = await provider.resolveIdentity(request);

      expect(identity).toEqual({
        tenantId: "tenant_abc",
        userId: "user_def",
      });
    });

    it("ignores empty header values", async () => {
      const provider = new HeaderIdentityProvider();
      const request = createMockRequest({
        "x-tenant-id": "tenant_123",
        "x-user-id": "",
        "x-workspace-id": "   ",
      });

      const identity = await provider.resolveIdentity(request);

      expect(identity).toEqual({
        tenantId: "tenant_123",
      });
    });
  });

  describe("AnonymousIdentityProvider", () => {
    it("always returns undefined", async () => {
      const provider = new AnonymousIdentityProvider();
      const request = createMockRequest({
        "x-tenant-id": "tenant_123",
        "x-user-id": "user_456",
      });

      const identity = await provider.resolveIdentity(request);

      expect(identity).toBeUndefined();
    });
  });
});

function createMockRequest(headers: Record<string, string>) {
  return {
    header: (name: string) => headers[name],
  };
}
