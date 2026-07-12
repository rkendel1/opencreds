# Identity Model

This document describes OpenConnector's identity model for multi-tenant deployments.

## Overview

OpenConnector supports multi-tenant deployments where resources are isolated by identity.
The identity model provides:

- **Tenant isolation**: Organizations are completely isolated from each other
- **User isolation**: Users within a tenant cannot access each other's credentials
- **Workspace support**: Optional workspace metadata for organizing resources
- **Legacy compatibility**: Single-user deployments work without identity configuration

## Identity Context

Every runtime operation can include an `IdentityContext` with the following fields:

```typescript
interface IdentityContext {
  /** Tenant boundary for the current operation. */
  tenantId?: string;
  /** User performing the operation. */
  userId?: string;
  /** Optional workspace scope within the tenant. */
  workspaceId?: string;
}
```

When all fields are undefined, the runtime operates in **legacy mode** with no isolation
boundaries, maintaining backward compatibility with single-user deployments.

## Identity Precedence

When resolving credentials, the identity model follows this precedence:

```
Workspace (currently: stored as metadata only)
    ↓
User (currently: enforced isolation)
    ↓
Tenant (currently: enforced isolation)
```

**Current Implementation**:

- Tenant + User isolation is **enforced** in storage queries
- Workspace ID is **stored** but not used for isolation
- User credentials override tenant defaults

**Future Enhancement**:

- Workspace-level isolation (would require schema changes)
- Workspace overrides user preferences

If nothing exists → Return Not Found

**Important**: The system never silently falls back across identities.

## Storage Isolation

Every storage operation includes identity filtering:

### Current Implementation

Isolation is enforced at the **tenant + user** level:

```sql
WHERE
  tenant_id = ?
  AND user_id = ?
  AND service = ?
  AND connection_name = ?
```

### Legacy Mode

When identity is undefined (single-user deployment):

```sql
WHERE
  tenant_id = ''
  AND user_id = ''
  AND service = ?
  AND connection_name = ?
```

Legacy connections use empty strings for tenant_id and user_id, keeping them
separate from identity-scoped connections.

## Storage Interfaces

All storage interfaces accept an optional `IdentityContext` parameter:

### ConnectionStore

```typescript
interface IConnectionStore {
  get(service: string, connectionName: string, identity?: IdentityContext): Promise<ResolvedCredential | undefined>;
  set(
    service: string,
    connectionName: string,
    credential: ResolvedCredential,
    identity?: IdentityContext,
  ): Promise<void>;
  delete(service: string, connectionName: string, identity?: IdentityContext): Promise<void>;
  list(identity?: IdentityContext): Promise<StoredConnection[]>;
}
```

### RuntimeTokenStore

```typescript
interface IRuntimeTokenStore {
  add(record: RuntimeTokenRecord): Promise<void>;
  list(identity?: IdentityContext): Promise<RuntimeTokenRecord[]>;
  revoke(id: string, identity?: IdentityContext): Promise<boolean>;
  markUsed(id: string, usedAt: string): Promise<void>;
}
```

## OAuth Flow Propagation

When OAuth authorization begins, the identity context is persisted with the OAuth state:

```typescript
interface OAuthAuthorizationState {
  service: string;
  connectionName?: string;
  state: string;
  createdAt: string;
  pkceCodeVerifier?: string;
  /** Identity context of the user initiating the OAuth flow. */
  identity?: IdentityContext;
}
```

On callback, the identity is recovered and the resulting credential is stored
under the correct owner. This ensures OAuth flows preserve identity through
the redirect process.

## Runtime Token Propagation

Runtime token verification returns identity context:

```typescript
interface RuntimeTokenVerification {
  verified: boolean;
  tokenId?: string;
  identity?: IdentityContext;
}
```

When a runtime token is verified, the associated identity is automatically
available for credential resolution. Providers never perform identity lookups—
they receive already-resolved credentials.

## Action Execution

The execution pipeline includes identity:

```
Request
    ↓
Identity Resolution
    ↓
Runtime Token Verification
    ↓
Connection Resolution (identity-scoped)
    ↓
Provider Executor
    ↓
Action Result
```

Providers never perform identity lookups. They receive already-resolved
credentials scoped to the appropriate identity.

## Isolation Guarantees

### Cross-Tenant Isolation

- Tenant A **cannot** access Tenant B's credentials
- Tenant A **cannot** list Tenant B's connections
- Tenant A **cannot** revoke Tenant B's runtime tokens

### Cross-User Isolation

- User A **cannot** access User B's credentials (within the same tenant)
- User A **cannot** see User B's connections in list operations
- User A **cannot** revoke User B's runtime tokens

### Delete Protection

Deletion operations are scoped to identity:

- Deleting a connection only removes it for the matching identity
- Other users' connections with the same service/name remain unaffected

## Migration Examples

### Single-User to Multi-Tenant

1. Existing connections remain accessible in legacy mode (no identity)
2. New connections with identity are isolated
3. Legacy connections are not visible to identity-scoped queries
4. No data migration required—modes coexist

### Adding Identity to API Calls

Before (legacy):

```typescript
await connections.getCredential("github", "default");
```

After (identity-aware):

```typescript
const identity = { tenantId: "org-123", userId: "user-456" };
await connections.getCredential("github", "default", identity);
```

## Security Considerations

1. **Never trust client-provided identity in untrusted contexts**
   - Use authenticated identity from JWT tokens or session
   - The `HeaderIdentityProvider` is for trusted internal requests only

2. **Identity fields are part of the security boundary**
   - Always include identity in storage operations
   - Never skip identity checks for "convenience"

3. **Audit logging should include identity**
   - Log tenant, user, and workspace with every operation
   - Include identity in error messages for debugging

## Future Enhancements

### Workspace-Level Isolation (Planned)

Full workspace isolation would require schema changes to include `workspace_id`
in the primary key. Currently, workspace_id is stored as metadata for audit
purposes.

### RBAC (Planned)

Role-based access control could extend the identity model to include:

- Roles and permissions within tenants
- Resource-level access control
- Admin delegation patterns
