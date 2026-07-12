/**
 * Security tests for identity enforcement and storage isolation.
 *
 * These tests verify that:
 * - Cross-tenant credential access is impossible
 * - Cross-user credential access is impossible
 * - OAuth flows preserve identity through callbacks
 * - Runtime tokens return correct identity
 * - Legacy mode (no identity) behaves as before
 */

import type { IdentityContext } from "../../identity/types.ts";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeTokenService } from "../../server/storage/runtime-token-service.ts";
import { SqliteRuntimeDatabase } from "../../server/storage/sqlite-runtime-store.ts";

const tempDirs: string[] = [];
const githubProfile = {
  accountId: "github:octocat",
  displayName: "octocat",
  grantedScopes: [],
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createDatabasePath(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "identity-isolation-test-"));
  tempDirs.push(tempDir);
  return join(tempDir, "runtime.db");
}

describe("Connection Store Identity Isolation", () => {
  it("User A stores GitHub credential, User B cannot access it", async () => {
    const databasePath = await createDatabasePath();
    const database = new SqliteRuntimeDatabase(databasePath);

    const userA: IdentityContext = { tenantId: "tenant-1", userId: "user-a" };
    const userB: IdentityContext = { tenantId: "tenant-1", userId: "user-b" };

    // User A stores a credential
    await database.connectionStore.set(
      "github",
      "default",
      {
        authType: "api_key",
        apiKey: "user-a-token",
        values: { apiKey: "user-a-token" },
        profile: githubProfile,
        metadata: {},
      },
      userA,
    );

    // User A can access their credential
    const userACredential = await database.connectionStore.get("github", "default", userA);
    expect(userACredential).toMatchObject({ apiKey: "user-a-token" });

    // User B cannot access User A's credential
    const userBCredential = await database.connectionStore.get("github", "default", userB);
    expect(userBCredential).toBeUndefined();

    database.close();
  });

  it("Tenant A cannot access Tenant B connections", async () => {
    const databasePath = await createDatabasePath();
    const database = new SqliteRuntimeDatabase(databasePath);

    const tenantA: IdentityContext = { tenantId: "tenant-a", userId: "user-1" };
    const tenantB: IdentityContext = { tenantId: "tenant-b", userId: "user-1" };

    // Tenant A stores a credential
    await database.connectionStore.set(
      "github",
      "default",
      {
        authType: "api_key",
        apiKey: "tenant-a-token",
        values: { apiKey: "tenant-a-token" },
        profile: githubProfile,
        metadata: {},
      },
      tenantA,
    );

    // Tenant A can access their credential
    const tenantACredential = await database.connectionStore.get("github", "default", tenantA);
    expect(tenantACredential).toMatchObject({ apiKey: "tenant-a-token" });

    // Tenant B cannot access Tenant A's credential
    const tenantBCredential = await database.connectionStore.get("github", "default", tenantB);
    expect(tenantBCredential).toBeUndefined();

    database.close();
  });

  it("Tenant A cannot list Tenant B resources", async () => {
    const databasePath = await createDatabasePath();
    const database = new SqliteRuntimeDatabase(databasePath);

    const tenantA: IdentityContext = { tenantId: "tenant-a", userId: "user-1" };
    const tenantB: IdentityContext = { tenantId: "tenant-b", userId: "user-1" };

    // Both tenants store credentials
    await database.connectionStore.set(
      "github",
      "default",
      {
        authType: "api_key",
        apiKey: "tenant-a-token",
        values: { apiKey: "tenant-a-token" },
        profile: githubProfile,
        metadata: {},
      },
      tenantA,
    );
    await database.connectionStore.set(
      "github",
      "default",
      {
        authType: "api_key",
        apiKey: "tenant-b-token",
        values: { apiKey: "tenant-b-token" },
        profile: githubProfile,
        metadata: {},
      },
      tenantB,
    );

    // Tenant A only sees their connection
    const tenantAList = await database.connectionStore.list(tenantA);
    expect(tenantAList).toHaveLength(1);
    expect(tenantAList[0].credential).toMatchObject({ apiKey: "tenant-a-token" });

    // Tenant B only sees their connection
    const tenantBList = await database.connectionStore.list(tenantB);
    expect(tenantBList).toHaveLength(1);
    expect(tenantBList[0].credential).toMatchObject({ apiKey: "tenant-b-token" });

    database.close();
  });

  it("Delete only removes the connection for the matching identity", async () => {
    const databasePath = await createDatabasePath();
    const database = new SqliteRuntimeDatabase(databasePath);

    const userA: IdentityContext = { tenantId: "tenant-1", userId: "user-a" };
    const userB: IdentityContext = { tenantId: "tenant-1", userId: "user-b" };

    // Both users store credentials
    await database.connectionStore.set(
      "github",
      "default",
      {
        authType: "api_key",
        apiKey: "user-a-token",
        values: { apiKey: "user-a-token" },
        profile: githubProfile,
        metadata: {},
      },
      userA,
    );
    await database.connectionStore.set(
      "github",
      "default",
      {
        authType: "api_key",
        apiKey: "user-b-token",
        values: { apiKey: "user-b-token" },
        profile: githubProfile,
        metadata: {},
      },
      userB,
    );

    // User A deletes their connection
    await database.connectionStore.delete("github", "default", userA);

    // User A's connection is gone
    const userACredential = await database.connectionStore.get("github", "default", userA);
    expect(userACredential).toBeUndefined();

    // User B's connection still exists
    const userBCredential = await database.connectionStore.get("github", "default", userB);
    expect(userBCredential).toMatchObject({ apiKey: "user-b-token" });

    database.close();
  });
});

describe("Runtime Token Identity Isolation", () => {
  it("Token verification returns correct identity", async () => {
    const databasePath = await createDatabasePath();
    const database = new SqliteRuntimeDatabase(databasePath);
    const tokens = new RuntimeTokenService(database.runtimeTokenStore);

    const userIdentity: IdentityContext = { tenantId: "tenant-1", userId: "user-1" };

    // Create token with identity
    const { token } = await tokens.createToken("Test Token", userIdentity);

    // Verify token returns identity
    const verification = await tokens.verifyTokenWithIdentity(token);
    expect(verification.verified).toBe(true);
    expect(verification.identity).toMatchObject(userIdentity);

    database.close();
  });

  it("Token list is scoped to identity", async () => {
    const databasePath = await createDatabasePath();
    const database = new SqliteRuntimeDatabase(databasePath);
    const tokens = new RuntimeTokenService(database.runtimeTokenStore);

    const userA: IdentityContext = { tenantId: "tenant-1", userId: "user-a" };
    const userB: IdentityContext = { tenantId: "tenant-1", userId: "user-b" };

    // Create tokens for both users
    await tokens.createToken("User A Token", userA);
    await tokens.createToken("User B Token", userB);

    // User A only sees their token
    const userATokens = await tokens.listTokens(userA);
    expect(userATokens).toHaveLength(1);
    expect(userATokens[0].name).toBe("User A Token");

    // User B only sees their token
    const userBTokens = await tokens.listTokens(userB);
    expect(userBTokens).toHaveLength(1);
    expect(userBTokens[0].name).toBe("User B Token");

    database.close();
  });

  it("Token revocation is scoped to identity", async () => {
    const databasePath = await createDatabasePath();
    const database = new SqliteRuntimeDatabase(databasePath);
    const tokens = new RuntimeTokenService(database.runtimeTokenStore);

    const userA: IdentityContext = { tenantId: "tenant-1", userId: "user-a" };
    const userB: IdentityContext = { tenantId: "tenant-1", userId: "user-b" };

    // Create tokens for both users
    const tokenA = await tokens.createToken("User A Token", userA);
    const tokenB = await tokens.createToken("User B Token", userB);

    // User A tries to revoke User B's token (should fail)
    const userARevokeBResult = await tokens.revokeToken(tokenB.record.id, userA);
    expect(userARevokeBResult).toBe(false);

    // User B's token should still work
    const verification = await tokens.verifyToken(tokenB.token);
    expect(verification).toBe(true);

    // User A can revoke their own token
    const userARevokeAResult = await tokens.revokeToken(tokenA.record.id, userA);
    expect(userARevokeAResult).toBe(true);

    database.close();
  });
});

describe("Legacy Mode Compatibility", () => {
  it("No identity behaves exactly as before for connections", async () => {
    const databasePath = await createDatabasePath();
    const database = new SqliteRuntimeDatabase(databasePath);

    // Store without identity (legacy mode)
    await database.connectionStore.set("github", "default", {
      authType: "api_key",
      apiKey: "legacy-token",
      values: { apiKey: "legacy-token" },
      profile: githubProfile,
      metadata: {},
    });

    // Get without identity (legacy mode)
    const credential = await database.connectionStore.get("github", "default");
    expect(credential).toMatchObject({ apiKey: "legacy-token" });

    // List without identity (legacy mode)
    const connections = await database.connectionStore.list();
    expect(connections).toHaveLength(1);
    expect(connections[0].credential).toMatchObject({ apiKey: "legacy-token" });

    database.close();
  });

  it("No identity behaves exactly as before for runtime tokens", async () => {
    const databasePath = await createDatabasePath();
    const database = new SqliteRuntimeDatabase(databasePath);
    const tokens = new RuntimeTokenService(database.runtimeTokenStore);

    // Create token without identity
    const { token, record } = await tokens.createToken("Legacy Token");

    // Verify works
    const verification = await tokens.verifyToken(token);
    expect(verification).toBe(true);

    // List without identity
    const tokenList = await tokens.listTokens();
    expect(tokenList.length).toBeGreaterThanOrEqual(1);
    expect(tokenList.find((t) => t.id === record.id)).toBeDefined();

    // Revoke without identity
    const revokeResult = await tokens.revokeToken(record.id);
    expect(revokeResult).toBe(true);

    database.close();
  });

  it("Legacy connections are not visible to identity-scoped queries", async () => {
    const databasePath = await createDatabasePath();
    const database = new SqliteRuntimeDatabase(databasePath);

    const userIdentity: IdentityContext = { tenantId: "tenant-1", userId: "user-1" };

    // Store legacy connection (no identity)
    await database.connectionStore.set("github", "default", {
      authType: "api_key",
      apiKey: "legacy-token",
      values: { apiKey: "legacy-token" },
      profile: githubProfile,
      metadata: {},
    });

    // Identity-scoped query should not see legacy connection
    const identityScopedCredential = await database.connectionStore.get("github", "default", userIdentity);
    expect(identityScopedCredential).toBeUndefined();

    const identityScopedList = await database.connectionStore.list(userIdentity);
    expect(identityScopedList).toHaveLength(0);

    database.close();
  });
});

describe("OAuth State Identity Preservation", () => {
  it("OAuth state preserves identity through the flow", async () => {
    const databasePath = await createDatabasePath();
    const database = new SqliteRuntimeDatabase(databasePath);

    const userIdentity: IdentityContext = { tenantId: "tenant-1", userId: "user-1" };

    // Store OAuth state with identity
    await database.oauthStateStore.set({
      service: "github",
      state: "oauth-state-123",
      createdAt: new Date().toISOString(),
      identity: userIdentity,
    });

    // Take the state and verify identity is preserved
    const state = await database.oauthStateStore.take("oauth-state-123");
    expect(state).toBeDefined();
    expect(state?.identity).toMatchObject(userIdentity);

    database.close();
  });
});

describe("Workspace Isolation", () => {
  it("Workspace ID is preserved in stored connections", async () => {
    const databasePath = await createDatabasePath();
    const database = new SqliteRuntimeDatabase(databasePath);

    const workspaceA: IdentityContext = { tenantId: "tenant-1", userId: "user-1", workspaceId: "workspace-a" };

    // Store connection in workspace A
    await database.connectionStore.set(
      "github",
      "default",
      {
        authType: "api_key",
        apiKey: "workspace-a-token",
        values: { apiKey: "workspace-a-token" },
        profile: githubProfile,
        metadata: {},
      },
      workspaceA,
    );

    // Connection includes workspace in its identity
    const connections = await database.connectionStore.list(workspaceA);
    expect(connections).toHaveLength(1);
    expect(connections[0].identity?.workspaceId).toBe("workspace-a");

    database.close();
  });

  it("Same user in same tenant shares connections across workspaces (current behavior)", async () => {
    // NOTE: Current implementation enforces tenant/user isolation, not workspace isolation.
    // Workspace ID is stored for audit and metadata purposes. Full workspace isolation
    // would require schema changes to include workspace_id in the primary key.
    const databasePath = await createDatabasePath();
    const database = new SqliteRuntimeDatabase(databasePath);

    const workspaceA: IdentityContext = { tenantId: "tenant-1", userId: "user-1", workspaceId: "workspace-a" };
    const workspaceB: IdentityContext = { tenantId: "tenant-1", userId: "user-1", workspaceId: "workspace-b" };

    // Store connection in workspace A
    await database.connectionStore.set(
      "github",
      "default",
      {
        authType: "api_key",
        apiKey: "workspace-a-token",
        values: { apiKey: "workspace-a-token" },
        profile: githubProfile,
        metadata: {},
      },
      workspaceA,
    );

    // Current behavior: Same user can access from workspace B
    // This is because isolation is at tenant/user level, not workspace level
    const workspaceBCredential = await database.connectionStore.get("github", "default", workspaceB);
    expect(workspaceBCredential).toMatchObject({ apiKey: "workspace-a-token" });

    database.close();
  });
});
