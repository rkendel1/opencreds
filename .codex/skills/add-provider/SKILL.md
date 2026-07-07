---
name: add-provider
description: Add or extend a provider under src/providers/<service> following this repo's catalog and executor contract.
---

# Adding a provider

This is the agent-consumable version of [CONTRIBUTING.md](../../../CONTRIBUTING.md#adding-providers).
Follow [AGENTS.md](../../../AGENTS.md) for style; this file only covers the provider workflow itself.

## 1. Files you own

A provider lives entirely under `src/providers/<service>/`:

- `definition.ts` — exports `provider: ProviderDefinition` (`src/core/types.ts`). Catalog-only data:
  `service`, `displayName`, `categories`, `authTypes`, `auth`, optional `homepageUrl`/`iconUrl`, and
  `actions`. Definitions must not import executor modules, call `fetch`, or read credentials.
- `actions.ts` (optional but common once a provider has more than a couple of actions) — the
  `ActionDefinition[]` array, built with `defineProviderAction(service, input)` from
  `src/core/provider-definition.ts` so every action gets a consistent `id: "<service>.<name>"` without
  repeating `service` on each entry.
- `executors.ts` — exports `executors: ProviderExecutors`, built with `defineProviderExecutors` from
  `src/providers/provider-runtime.ts`. This is the only place that calls `fetch` and reads credentials.
- Provider-local runtime helper files as needed (e.g. one file per resource area, see the GitHub
  provider's `runtime-issue.ts`, `runtime-pull-request.ts`, etc., merged with `Object.assign` in
  `executors.ts`).

Never add an `index.ts` barrel file (see AGENTS.md). Callers import the concrete module they need.

## 2. Build schemas with `s`, not hand-rolled JSON Schema

Import `s` (alias for `jsonSchema`) from `src/core/json-schema.ts` for every `inputSchema`/`outputSchema`.
It covers the common shapes: `s.object(...)`, `s.array(...)`, `s.string(...)`, `s.stringEnum(...)`,
`s.integer(...)`, `s.nullable(...)`, `s.ref(...)` with `defs` for recursive/shared shapes,
`s.actionInput(...)`/`s.actionOutput(...)` for the common "required = all keys" case, and more. Drop to a
plain JSON Schema object only for a genuinely provider-specific edge case.

## 3. Pick the right auth pattern

`AuthType` is `"no_auth" | "api_key" | "custom_credential" | "oauth2"`, and `auth: ProviderAuthDefinition[]`
can declare more than one — a provider can support both `oauth2` and `api_key` (see GitHub) so users
pick either.

**No-auth reference: `src/providers/hackernews`.** Single `auth: [{ type: "no_auth" }]`. Executors call
the public API directly (`requestFirebase`/`requestAlgolia` helpers built on `fetch` +
`setSearchParams`/`readProviderJson` from `provider-runtime.ts`). No credential validators needed.

**OAuth2 + api_key reference: `src/providers/github`.** `definition.ts` declares an `oauth2` entry
(`authorizationUrl`, `tokenUrl`, `scopes` from a provider-local `scopes.ts` constant,
`tokenEndpointAuthMethod`) alongside an `api_key` entry (personal access token). `executors.ts` builds
one shared action context via `requireBearerCredential(context, service)` from `provider-runtime.ts` —
both auth modes converge to a bearer token before any handler runs, so handlers don't need to know which
auth mode is active. It also exports `credentialValidators: CredentialValidators` (`apiKey` and `oauth2`
both call the same cheap "who am I" request) so the runtime can populate `CredentialProfile`
(`accountId`/`displayName`) before saving a connection. Token refresh is centralized in
`src/oauth/oauth-credential-refresh-service.ts` — providers never implement their own refresh logic.

Use provider-native scope/permission strings in `requiredScopes`/`providerPermissions` (e.g. GitHub's
own OAuth scope names), not private internal aliases.

## 4. Keep runtime lazy

Catalog generation imports `definition.ts` for every provider, so it must stay cheap and side-effect
free. `executors.ts` (and any provider-local runtime helper it imports) should only be loaded when an
action is actually executed — don't import executor modules from `definition.ts`, and don't import
`definition.ts` from executor modules just to reuse `displayName`/scopes/etc. Inject that metadata from
the caller that already has the definition/catalog instead.

## 5. Generate and verify

```bash
npm run generate:catalog   # regenerates src/providers/registry.generated.ts and catalog/apps/*.json
npm run fix-check          # lint fix + format fix + typecheck — required before opening a PR
```

`registry.generated.ts` and `catalog/apps/*.json` are gitignored generated output — never hand-edit
them; re-run `generate:catalog` instead. See [docs/catalog-format.md](../../../docs/catalog-format.md)
for what the generated catalog adds at runtime (`locallyExecutable`, `catalogOnly`, `needsCredential`,
`noAuthRunnable`).

## 6. Tests

Provider coverage is mostly centralized, not per-provider: `src/providers/provider-proxy-loader-*.test.ts`
(split alphabetically by service name) load every real provider module through `ProviderLoader` and
assert against a stubbed global `fetch`, checking URL/header construction and endpoint-scoping guards. A
new provider is exercised by these loader tests automatically. Add a dedicated `executors.test.ts` next
to your provider (see `src/providers/ossinsight/executors.test.ts`) only when the provider has
non-trivial logic beyond simple request/response mapping — for example a proxy executor with its own
validation branches.

Run `npm test` after `npm run fix-check`.

## 7. Third-party rights

Don't contribute third-party logos, icons, screenshots, documentation excerpts, or API schemas unless
you have the right to. Prefer linking to official public assets over copying brand files into this repo.
See [CONTRIBUTING.md](../../../CONTRIBUTING.md#third-party-rights).
