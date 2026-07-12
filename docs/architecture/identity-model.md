# Identity Model

OpenConnector's identity model provides the foundation for multi-tenant SaaS deployments while preserving full backward compatibility with single-user/self-hosted installations.

## Overview

The identity model introduces three core concepts that scope all runtime operations:

- **Tenant**: An isolated organization or account boundary
- **User**: An individual identity within a tenant
- **Workspace**: A logical grouping of resources within a tenant (optional)

## Identity Context

Every runtime operation can optionally receive an `IdentityContext`:

```typescript
interface IdentityContext {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
}
```

When all fields are undefined, the runtime operates in single-user mode with no isolation boundaries.

## Single-User Mode (Default)

Existing deployments continue working without any changes:

- No identity context is required
- All resources (connections, tokens, runs) exist in a global namespace
- SQLite database works as before
- No migration or configuration changes needed

## Multi-Tenant Mode

When identity context is provided:

- Connections are scoped to tenant/user
- Runtime tokens are associated with identities
- Queries are automatically filtered by identity
- Audit events include identity attribution

### Enabling Multi-Tenant Mode

Multi-tenant mode is enabled by providing identity context through request headers:

```
X-Tenant-ID: tenant_123
X-User-ID: user_456
X-Workspace-ID: workspace_789
```

These headers should be set by an upstream authentication gateway that validates user sessions and resolves identity.

## Data Isolation

### Connections

Each connection is scoped by tenant and user:

```sql
-- User A's connection
service='github', connection_name='work', tenant_id='t1', user_id='u1'

-- User B's connection (same logical name, different owner)
service='github', connection_name='work', tenant_id='t1', user_id='u2'
```

User A cannot access User B's connection, even with the same service and name.

### Runtime Tokens

Tokens are scoped by tenant and user:

- Tokens created with identity context are owned by that identity
- Token verification returns the associated identity
- Listing tokens filters by identity context

### Audit Trail

All operations are attributed to the identity that performed them:

- `connection.created`, `connection.used`, `connection.deleted`
- `token.created`, `token.revoked`
- `action.executed`

## API Response Metadata

When identity context is present, API responses include identity metadata:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "identity": {
      "tenant": "tenant_123",
      "user": "user_456"
    }
  }
}
```

## Database Schema

Identity columns are nullable to preserve backward compatibility:

### connections

| Column       | Type      | Description              |
| ------------ | --------- | ------------------------ |
| tenant_id    | TEXT NULL | Tenant boundary          |
| user_id      | TEXT NULL | User owner               |
| workspace_id | TEXT NULL | Optional workspace scope |

### runtime_tokens

| Column    | Type      | Description     |
| --------- | --------- | --------------- |
| tenant_id | TEXT NULL | Tenant boundary |
| user_id   | TEXT NULL | User owner      |

### runs

| Column       | Type      | Description        |
| ------------ | --------- | ------------------ |
| tenant_id    | TEXT NULL | Tenant boundary    |
| user_id      | TEXT NULL | User who triggered |
| workspace_id | TEXT NULL | Workspace context  |

## Migration Path

1. **No changes required** for existing single-user deployments
2. Run database migration `0003_identity_context.sql` to add nullable columns
3. Configure identity provider middleware if enabling multi-tenant mode
4. Gradually roll out tenant/user scoping as needed

## Implementation Components

### Identity Types (`src/identity/types.ts`)

Core type definitions for identity primitives.

### Identity Context (`src/identity/identity-context.ts`)

Utilities for creating, normalizing, and serializing identity context.

### Identity Provider (`src/identity/identity-provider.ts`)

Abstractions for resolving identity from requests:

- `HeaderIdentityProvider`: Reads from X-Tenant-ID, X-User-ID headers
- `AnonymousIdentityProvider`: Always returns undefined (single-user mode)

### Request Middleware (`src/server/middleware/identity-context.ts`)

Hono middleware that extracts identity from incoming requests.

### Audit Logger (`src/audit/types.ts`)

Interface for recording audit events with identity attribution.

## Future Extensions

This foundation enables future capabilities:

- **Postgres Storage**: Full multi-tenant support with row-level security
- **Tenant Isolation**: Dedicated resource quotas per tenant
- **RBAC**: Role-based access control within tenants
- **Workspace Permissions**: Fine-grained access within projects
