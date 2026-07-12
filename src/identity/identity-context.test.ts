import { describe, expect, it } from "vitest";
import { createIdentityContext, mergeIdentityContext, serializeIdentityContext } from "./identity-context.ts";
import { isEmptyIdentityContext, normalizeIdentityContext } from "./types.ts";

describe("identity context", () => {
  describe("isEmptyIdentityContext", () => {
    it("returns true for undefined context", () => {
      expect(isEmptyIdentityContext(undefined)).toBe(true);
    });

    it("returns true for empty object", () => {
      expect(isEmptyIdentityContext({})).toBe(true);
    });

    it("returns true when all fields are undefined", () => {
      expect(isEmptyIdentityContext({ tenantId: undefined, userId: undefined, workspaceId: undefined })).toBe(true);
    });

    it("returns false when tenantId is set", () => {
      expect(isEmptyIdentityContext({ tenantId: "tenant_1" })).toBe(false);
    });

    it("returns false when userId is set", () => {
      expect(isEmptyIdentityContext({ userId: "user_1" })).toBe(false);
    });

    it("returns false when workspaceId is set", () => {
      expect(isEmptyIdentityContext({ workspaceId: "workspace_1" })).toBe(false);
    });
  });

  describe("normalizeIdentityContext", () => {
    it("returns empty object for undefined", () => {
      expect(normalizeIdentityContext(undefined)).toEqual({});
    });

    it("removes undefined fields", () => {
      expect(normalizeIdentityContext({ tenantId: "t1", userId: undefined })).toEqual({ tenantId: "t1" });
    });

    it("keeps all defined fields", () => {
      expect(normalizeIdentityContext({ tenantId: "t1", userId: "u1", workspaceId: "w1" })).toEqual({
        tenantId: "t1",
        userId: "u1",
        workspaceId: "w1",
      });
    });
  });

  describe("createIdentityContext", () => {
    it("returns undefined for empty options", () => {
      expect(createIdentityContext({})).toBeUndefined();
    });

    it("returns undefined for whitespace-only values", () => {
      expect(createIdentityContext({ tenantId: "   ", userId: "" })).toBeUndefined();
    });

    it("trims whitespace from values", () => {
      expect(createIdentityContext({ tenantId: "  tenant_1  " })).toEqual({ tenantId: "tenant_1" });
    });

    it("creates context with valid values", () => {
      expect(createIdentityContext({ tenantId: "t1", userId: "u1" })).toEqual({
        tenantId: "t1",
        userId: "u1",
      });
    });
  });

  describe("mergeIdentityContext", () => {
    it("returns empty for two undefined contexts", () => {
      expect(mergeIdentityContext(undefined, undefined)).toEqual({});
    });

    it("returns base when override is undefined", () => {
      expect(mergeIdentityContext({ tenantId: "t1" }, undefined)).toEqual({ tenantId: "t1" });
    });

    it("returns override when base is undefined", () => {
      expect(mergeIdentityContext(undefined, { tenantId: "t2" })).toEqual({ tenantId: "t2" });
    });

    it("override takes precedence", () => {
      expect(mergeIdentityContext({ tenantId: "t1", userId: "u1" }, { tenantId: "t2" })).toEqual({
        tenantId: "t2",
        userId: "u1",
      });
    });
  });

  describe("serializeIdentityContext", () => {
    it("returns 'anonymous' for undefined", () => {
      expect(serializeIdentityContext(undefined)).toBe("anonymous");
    });

    it("returns 'anonymous' for empty context", () => {
      expect(serializeIdentityContext({})).toBe("anonymous");
    });

    it("serializes tenant only", () => {
      expect(serializeIdentityContext({ tenantId: "t1" })).toBe("tenant:t1");
    });

    it("serializes all fields", () => {
      expect(serializeIdentityContext({ tenantId: "t1", userId: "u1", workspaceId: "w1" })).toBe(
        "tenant:t1/user:u1/workspace:w1",
      );
    });
  });
});
