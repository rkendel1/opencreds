# SaaS Connection Mesh Capability Audit

This document audits OpenConnector's readiness to serve as a Connection Mesh for multi-tenant SaaS
applications. Each capability is verified with evidence from the source code, and gaps are
documented with concrete recommendations.

## Summary

| Capability                 | Status       | Source Evidence                               |
| -------------------------- | ------------ | --------------------------------------------- |
| OAuth                      | ✅ Supported | `src/oauth/oauth-flow-service.ts`             |
| API Keys                   | ✅ Supported | `src/connection-service.ts`                   |
| Multiple named connections | ✅ Supported | `src/connection-service.ts:connectionName`    |
| Multiple providers         | ✅ Supported | 1,000+ providers in `src/providers/`          |
| Runtime tokens             | ✅ Supported | `src/server/storage/runtime-token-service.ts` |
| MCP                        | ✅ Supported | `src/mcp.ts`, `/mcp` endpoint                 |
| Multi-user                 | ⚠️ Gap       | Single-user design, no user identity          |
| Multi-tenant               | ⚠️ Gap       | No tenant isolation primitives                |
| Workspace isolation        | ⚠️ Gap       | Flat credential namespace                     |
| RBAC                       | ⚠️ Partial   | Action policy only, no user-level permissions |
| Secret namespaces          | ⚠️ Gap       | No scoped secret storage                      |
| Postgres backend           | ⚠️ Gap       | SQLite and D1 only                            |
| Horizontal scaling         | ⚠️ Partial   | Stateless runtime, but SQLite is single-node  |

---

## Verified Capabilities

### OAuth (✅ Supported)

OAuth 2.0 flows are fully implemented with PKCE support, multiple token endpoint auth methods, and
automatic token refresh.

**Evidence:**

```
src/oauth/oauth-flow-service.ts
├── startAuthorization() - Builds authorization URL with PKCE code challenge
├── completeAuthorization() - Exchanges code for tokens
└── OAuthFlowService - Coordinates localhost OAuth with state management

src/oauth/oauth-credential-refresh-service.ts
├── Automatic token refresh when access tokens expire
└── Supports custom refresh token URLs per provider
```

**Key files:**

- `src/oauth/oauth-flow-service.ts:47-160` - OAuth flow coordination
- `src/oauth/oauth-token.ts` - Token exchange implementation
- `src/core/types.ts:90-148` - OAuth2AuthDefinition type

### API Keys (✅ Supported)

API key connections are stored with optional AES-256-GCM encryption and support extra credential
fields per provider.

**Evidence:**

```
src/connection-service.ts
├── connectWithApiKey() - Stores API key credentials
├── Validates against provider schema before storage
└── Supports extraFields for additional credential values

src/core/types.ts:54-65
├── ApiKeyAuthDefinition - Label, placeholder, description, extraFields
└── Built-in apiKey field with optional provider-specific extensions
```

### Multiple Named Connections (✅ Supported)

Each provider can have multiple named connections with one `default` connection per service.

**Evidence:**

```
src/connection-service.ts:18
└── defaultConnectionName = "default"

Database schema (migrations/0001_runtime.sql:1-7):
└── primary key (service, connection_name)

Connection selection:
└── x-oo-connector-alias header or alias query parameter
```

**Usage:**

```bash
# Create named connection
curl -X PUT /api/connections/github \
  -d '{"connectionName":"work","authType":"api_key","values":{"apiKey":"..."}}'

# Execute with named connection
curl -X POST /v1/actions/github.get_current_user \
  -H 'x-oo-connector-alias: work'
```

### Multiple Providers (✅ Supported)

The catalog includes over 1,000 provider definitions with 10,000+ actions.

**Evidence:**

```
src/providers/
├── 1,000+ provider directories (github, gmail, notion, etc.)
├── Each contains definition.ts, actions.ts, executors.ts
└── Provider registry generated at npm install

npm postinstall output:
└── Generated 1063 apps and 10244 actions.
```

### Runtime Tokens (✅ Supported)

Persistent runtime tokens for `/v1` and `/mcp` callers with hash-only storage.

**Evidence:**

```
src/server/storage/runtime-token-service.ts
├── createToken() - Generates oct_... prefixed tokens
├── verifyToken() - Timing-safe hash comparison
├── Token hashes stored in SQLite, raw tokens never persisted
└── Last-used tracking for token audit

migrations/0001_runtime.sql:21-28
├── runtime_tokens table with id, name, token_hash
└── revoked_at for soft deletion
```

### MCP (✅ Supported)

Model Context Protocol server with four discovery-oriented tools.

**Evidence:**

```
src/mcp.ts
├── list_apps - Browse providers with connection status
├── search_actions - Find actions by query and service
├── get_action_guide - Markdown guide for one action
└── execute_action - Run action with JSON input

src/server/connect-server.ts:493-506
└── handleMcp() - WebStandardStreamableHTTPServerTransport
```

**MCP endpoint:** `POST /mcp`

---

## Gap Analysis

### Multi-user (⚠️ Gap)

**Current state:** The runtime treats all callers as a single implicit user. Runtime tokens
authenticate callers but do not associate connections with specific users.

**Evidence:**

```
src/server/api/auth.ts
├── LocalAuthOptions - adminToken and runtimeToken only
├── No user identity in auth middleware
└── All tokens share the same connection pool

Database schema:
├── No user_id column in connections table
└── No user_id column in runtime_tokens table
```

**SaaS requirement:** User-scoped connections so User A's GitHub token differs from User B's.

**Recommended changes:**

1. Add `user_id` column to `connections` and `runtime_tokens` tables
2. Associate runtime tokens with users
3. Scope connection storage and retrieval by user ID
4. Add user identity to `ExecutionContext`

---

### Multi-tenant (⚠️ Gap)

**Current state:** No tenant isolation. All data shares one global namespace.

**Evidence:**

```
Database schema (migrations/0001_runtime.sql):
├── connections: (service, connection_name) - no tenant
├── oauth_client_configs: (service) - no tenant
├── runtime_tokens: (id) - no tenant
└── runs: (id) - no tenant
```

**SaaS requirement:** Tenant-scoped OAuth clients, connections, tokens, and logs.

**Recommended changes:**

1. Add `tenant_id` column to all tables
2. Pass tenant context through request middleware
3. Scope all queries by tenant ID
4. Add tenant-level OAuth client configuration

---

### Workspace Isolation (⚠️ Gap)

**Current state:** Flat namespace for connections. Named connections exist but without workspace
hierarchy.

**Evidence:**

```
src/connection-service.ts
├── Connections keyed by (service, connectionName)
├── No workspace or project concept
└── Single SQLite database for all connections
```

**SaaS requirement:** Workspace-scoped connections allowing different teams to manage separate
connection pools within a tenant.

**Recommended changes:**

1. Add `workspace_id` column to `connections` table
2. Allow workspaces within tenants
3. Workspace-scoped OAuth client config (optional)

---

### RBAC (⚠️ Partial)

**Current state:** Action policy allows/blocks actions globally. No user-level permissions.

**Evidence:**

```
src/core/action-policy.ts
├── ActionPolicyService - Global allow/block lists
├── OOMOL_CONNECT_ALLOWED_ACTIONS environment variable
├── OOMOL_CONNECT_BLOCKED_ACTIONS environment variable
└── No per-user or per-role evaluation

src/server/api/auth.ts
├── adminToken - Full admin access
├── runtimeToken - Full runtime access
└── No intermediate permission levels
```

**SaaS requirement:** Role-based permissions (viewer, editor, admin) with action-level grants.

**Recommended changes:**

1. Add `roles` table with permission definitions
2. Associate users with roles
3. Extend `ActionPolicyService` to evaluate user roles
4. Add connection-level permissions (read, manage)

---

### Secret Namespaces (⚠️ Gap)

**Current state:** Single encryption key for all secrets. No namespace isolation.

**Evidence:**

```
src/server/secrets/secret-codec.ts
├── AesGcmSecretCodec - Single passphrase for all secrets
├── OOMOL_CONNECT_ENCRYPTION_KEY environment variable
└── No per-tenant or per-workspace key support

Database:
├── All connections share one encryption context
└── Cannot rotate keys per tenant
```

**SaaS requirement:** Per-tenant encryption keys for data isolation compliance.

**Recommended changes:**

1. Derive per-tenant keys from master key
2. Store tenant key metadata
3. Support per-tenant key rotation
4. Optionally support customer-managed keys (BYOK)

---

### Postgres Backend (⚠️ Gap)

**Current state:** SQLite (local Node) and D1 (Cloudflare Workers) only.

**Evidence:**

```
src/server/storage/
├── sqlite-runtime-store.ts - SQLite for local runtime
├── d1-runtime-store.ts - D1 for Cloudflare Workers
└── No Postgres implementation

RuntimeDatabase interface:
├── connectionStore: IConnectionStore
├── oauthClientConfigStore: IOAuthClientConfigStore
├── oauthStateStore: IOAuthStateStore
├── runtimeTokenStore: IRuntimeTokenStore
└── runLogStore: IRunLogStore
```

**SaaS requirement:** Postgres for production workloads with connection pooling, replication, and
horizontal read scaling.

**Recommended changes:**

1. Implement `PostgresRuntimeDatabase` implementing `RuntimeDatabase`
2. Add connection pooling (pg-pool or similar)
3. Add environment variable for `DATABASE_URL`
4. Migration tooling for Postgres schema

---

### Horizontal Scaling (⚠️ Partial)

**Current state:** Stateless request handling allows multiple instances, but SQLite is single-node.

**Evidence:**

```
Stateless components:
├── src/server/connect-server.ts - No in-memory session state
├── src/oauth/oauth-flow-service.ts - State stored in database
├── Runtime tokens verified against database each request
└── No sticky sessions required

Scaling limitations:
├── SQLite database is single-file
├── No built-in connection pooling
└── No distributed caching layer
```

**SaaS requirement:** Multi-node deployment with shared state.

**Recommended changes:**

1. Add Postgres backend (addresses storage scaling)
2. Add Redis for OAuth state and short-lived caches
3. Add distributed run log aggregation
4. Document horizontal scaling architecture

---

## Architecture Recommendations

### Phase 1: Multi-tenant Foundation

1. **Tenant context middleware** - Extract tenant ID from request headers or JWT
2. **Tenant-scoped tables** - Add `tenant_id` to all state tables
3. **Per-tenant encryption** - Derive tenant keys from master key

### Phase 2: User Management

1. **User identity** - Add user ID to auth context
2. **User-scoped connections** - Allow personal vs. workspace connections
3. **Basic RBAC** - Admin/editor/viewer roles

### Phase 3: Enterprise Storage

1. **Postgres backend** - Full `RuntimeDatabase` implementation
2. **Connection pooling** - PgBouncer or built-in pooling
3. **Read replicas** - Scale action catalog reads

### Phase 4: Advanced Isolation

1. **Workspace hierarchy** - Teams within tenants
2. **Customer-managed keys** - BYOK for enterprise compliance
3. **Audit logging** - Who did what, when

---

## Verification Commands

```bash
# Verify OAuth support
grep -r "oauth2" src/core/types.ts | head -5

# Verify named connections
grep "connectionName" src/connection-service.ts | head -5

# Count providers
ls src/providers/ | wc -l

# Verify runtime tokens
cat src/server/storage/runtime-token-service.ts | head -30

# Verify MCP tools
grep "registerTool" src/mcp.ts | head -5

# Check for tenant columns (should find none)
grep -r "tenant_id" migrations/

# Check for user columns (should find none)
grep -r "user_id" migrations/
```

---

## Conclusion

OpenConnector provides a solid foundation for credential management with full OAuth support,
multiple providers, runtime tokens, and MCP integration. The primary gaps for SaaS Connection Mesh
readiness are:

1. **Multi-tenant isolation** - No tenant boundaries in current schema
2. **User identity** - Single implicit user model
3. **Postgres backend** - SQLite/D1 limits production scalability
4. **Per-tenant encryption** - Single global encryption key

The recommended phased approach allows incremental migration while maintaining backward
compatibility with the existing single-tenant deployment model.
