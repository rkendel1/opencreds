import type { ExecutionContext, ResolvedCredential } from "../core/types.ts";

import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderLoader } from "./provider-loader.ts";
import { generatedProxyExecutors } from "./proxy.generated.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProviderLoader proxy executors (generated)", () => {
  it("loads manual proxy executors with scoped endpoint coverage", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const proxy = await new ProviderLoader().loadProxyExecutor("alchemy");

    expect(proxy).toEqual(expect.any(Function));

    const credential: ResolvedCredential = {
      authType: "api_key",
      apiKey: "alchemy-key",
      values: { apiKey: "alchemy-key" },
      profile: { accountId: "acct_1", displayName: "Alchemy", grantedScopes: [] },
      metadata: {},
    };
    const context: ExecutionContext = {
      getCredential: async () => credential,
    };

    await proxy?.(
      {
        endpoint: "/v2/demo",
        method: "GET",
      },
      context,
    );
    const rejected = await proxy?.(
      {
        endpoint: "/admin",
        method: "GET",
      },
      context,
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(new URL("https://eth-mainnet.g.alchemy.com/v2/demo"), expect.any(Object));
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(Object.fromEntries((init.headers as Headers).entries())).toMatchObject({
      authorization: "Bearer alchemy-key",
      "user-agent": "oomol-connect/0.1",
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: {
        code: "invalid_input",
        message: "endpoint is not supported for this provider",
      },
    });
  });

  it("does not generate proxies when credential fields are provider-local request data", () => {
    expect(generatedProxyExecutors.telegram).toBeUndefined();
    expect(generatedProxyExecutors.whatsapp).toBeUndefined();
  });

  it("loads generated provider proxy executors when the provider module has no explicit proxy", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({ data: [] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const loader = new ProviderLoader();
    const proxy = await loader.loadProxyExecutor("a_leads");

    expect(proxy).toEqual(expect.any(Function));

    const credential: ResolvedCredential = {
      authType: "api_key",
      apiKey: "a-leads-key",
      values: { apiKey: "a-leads-key" },
      profile: { accountId: "acct_1", displayName: "A-Leads", grantedScopes: [] },
      metadata: {},
    };
    const context: ExecutionContext = {
      getCredential: async () => credential,
    };
    await proxy?.(
      {
        endpoint: "/search/verify-email",
        method: "GET",
      },
      context,
    );

    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://api.a-leads.co/gateway/v1/search/verify-email"),
      expect.any(Object),
    );
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(Object.fromEntries((init.headers as Headers).entries())).toMatchObject({
      "user-agent": "oomol-connect/0.1",
      "x-api-key": "a-leads-key",
    });
  });

  it("loads manual generated proxy definitions when auth is not safe to infer automatically", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({ data: [] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const proxy = await new ProviderLoader().loadProxyExecutor("anthropic");

    expect(proxy).toEqual(expect.any(Function));

    const credential: ResolvedCredential = {
      authType: "api_key",
      apiKey: "anthropic-key",
      values: { apiKey: "anthropic-key" },
      profile: { accountId: "acct_1", displayName: "Anthropic", grantedScopes: [] },
      metadata: {},
    };
    await proxy?.(
      {
        endpoint: "/v1/models",
        method: "GET",
      },
      { getCredential: async () => credential },
    );

    expect(fetcher).toHaveBeenCalledWith(new URL("https://api.anthropic.com/v1/models"), expect.any(Object));
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(Object.fromEntries((init.headers as Headers).entries())).toMatchObject({
      "user-agent": "oomol-connect/0.1",
      "x-api-key": "anthropic-key",
    });
  });

  it("keeps generated query API keys out of request headers", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({ data: [] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const proxy = await new ProviderLoader().loadProxyExecutor("mapbox");

    const credential: ResolvedCredential = {
      authType: "api_key",
      apiKey: "mapbox-token",
      values: { apiKey: "mapbox-token" },
      profile: { accountId: "acct_1", displayName: "Mapbox", grantedScopes: [] },
      metadata: {},
    };
    await proxy?.(
      {
        endpoint: "/search/geocode/v6/forward",
        method: "GET",
        query: { q: "Tokyo" },
      },
      { getCredential: async () => credential },
    );

    const url = fetcher.mock.calls[0]![0] as URL;
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(url.searchParams.get("access_token")).toBe("mapbox-token");
    expect((init.headers as Headers).has("access_token")).toBe(false);
  });

  it("uses provider-specific proxy auth when one credential field is not enough", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({ user: { id: 1 } }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const proxy = await new ProviderLoader().loadProxyExecutor("harvest");

    const credential: ResolvedCredential = {
      authType: "api_key",
      apiKey: "harvest-token",
      values: { apiKey: "harvest-token", accountId: "12345" },
      profile: { accountId: "acct_1", displayName: "Harvest", grantedScopes: [] },
      metadata: { accountId: "12345" },
    };
    await proxy?.(
      {
        endpoint: "/v2/users/me",
        method: "GET",
      },
      { getCredential: async () => credential },
    );

    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(Object.fromEntries((init.headers as Headers).entries())).toMatchObject({
      authorization: "Bearer harvest-token",
      "harvest-account-id": "12345",
    });
    expect((init.headers as Headers).has("accesstoken")).toBe(false);
  });
});
