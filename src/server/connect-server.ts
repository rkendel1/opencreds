import type { AuthMode, IAuthProvider } from "../auth/auth-provider.ts";
import type { CatalogStore, RuntimeActionDefinition } from "../catalog-store.ts";
import type { ConnectionService } from "../connection-service.ts";
import type { ActionPolicyService } from "../core/action-policy.ts";
import type { ActionSearchIndexProvider, ActionSearchResult } from "../core/action-search.ts";
import type { IProviderLoader } from "../providers/provider-loader.ts";
import type { LocalAuthOptions } from "./api/auth.ts";
import type { ITransitFileService } from "./files/transit-file-store.ts";
import type { Logger } from "./logger.ts";
import type { RunLogListInput } from "./storage/runtime-store.ts";
import type { RuntimeTokenService } from "./storage/runtime-token-service.ts";
import type { Context } from "hono";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { ConnectionError } from "../connection-service.ts";
import { DEFAULT_ACTION_SEARCH_LIMIT, createActionSearchIndexProvider, searchActions } from "../core/action-search.ts";
import { optionalRecord, optionalString, requiredString } from "../core/cast.ts";
import { createMcpServer, listMcpToolSummaries } from "../mcp.ts";
import { OAuthClientConfigError, OAuthClientConfigService } from "../oauth/oauth-client-config-service.ts";
import { OAuthFlowError, OAuthFlowService } from "../oauth/oauth-flow-service.ts";
import { ActionRunner } from "./actions/action-runner.ts";
import { renderActionMarkdown } from "./api/action-markdown.ts";
import { clearLocalAuthCookie, createLocalAuthMiddleware, readLocalAuthSession } from "./api/auth.ts";
import { getResponseCachePolicy } from "./api/cache-policy.ts";
import { HttpRequestError, internalError, jsonError, notFound, readJsonBody } from "./api/http-utils.ts";
import { renderOAuthCompletionPage } from "./api/oauth-completion-page.ts";
import { createOpenApiDocument } from "./api/openapi.ts";
import {
  mapConnectionErrorStatus,
  serializeRuntimeAction,
  serializeRuntimeActionService,
  serializeRuntimeConnectedApp,
  serializeRuntimeProvider,
  writeRuntimeActionResult,
  writeRuntimeFailure,
  writeRuntimeSuccess,
} from "./api/runtime-api.ts";
import { createTransitFileResponse, TransitFileError } from "./files/transit-file-store.ts";
import { createAuthenticationMiddleware, readIdentityContext } from "./middleware/authentication.ts";
import { ProxyRunner } from "./proxy/proxy-runner.ts";
import { decodeRunLogCursor } from "./storage/runtime-store.ts";

/**
 * Dependencies required to construct the local connector server.
 */
export interface IConnectServerOptions {
  catalog: CatalogStore;
  providerLoader: IProviderLoader;
  connections: ConnectionService;
  oauthClientConfigs: OAuthClientConfigService;
  oauthFlow: OAuthFlowService;
  runtimeTokens: RuntimeTokenService;
  actions: ActionRunner;
  transitFiles: ITransitFileService;
  staticRoot?: string;
  auth?: LocalAuthOptions;
  authProvider?: IAuthProvider;
  authMode?: AuthMode;
  storageBackend?: string;
  actionPolicy?: ActionPolicyService;
  actionSearch?: ActionSearchIndexProvider;
  registerStaticRoutes?: (app: Hono) => void;
  logger?: Logger;
}

/**
 * Local single-user HTTP server for catalog browsing, credential management,
 * action execution, OpenAPI docs, and MCP tool metadata.
 */
export class ConnectServer {
  private readonly options: IConnectServerOptions;
  private readonly actionSearch: ActionSearchIndexProvider;
  private readonly proxyRunner: ProxyRunner;
  private readonly startedAt = Date.now();

  constructor(options: IConnectServerOptions) {
    this.options = options;
    this.actionSearch = options.actionSearch ?? createActionSearchIndexProvider(options.catalog.actions);
    this.proxyRunner = new ProxyRunner({
      catalog: options.catalog,
      providerLoader: options.providerLoader,
      connections: options.connections,
      actionPolicy: options.actionPolicy,
      logger: options.logger,
    });
  }

  createApp(): Hono {
    const app = new Hono();
    const auth = this.options.auth ?? {};

    app.use("*", async (context, next) => {
      await next();
      const cachePolicy = getResponseCachePolicy(context.req.method, context.req.path, context.res.status);
      if (cachePolicy) {
        context.header("Cache-Control", cachePolicy.cacheControl);
        if (cachePolicy.cloudflareCdnCacheControl) {
          context.header("Cloudflare-CDN-Cache-Control", cachePolicy.cloudflareCdnCacheControl);
        }
        if (cachePolicy.vary) {
          context.header("Vary", cachePolicy.vary);
        }
      }
    });
    app.get("/", async (context) => context.json(await this.createRootResponse()));
    app.get("/health", (context) => context.json(this.createHealthResponse()));
    app.use("*", createLocalAuthMiddleware(auth));
    if (this.options.authProvider) {
      app.use(
        "*",
        createAuthenticationMiddleware({
          provider: this.options.authProvider,
          shouldAuthenticate: (context) => shouldAuthenticateRequest(context.req.path, context.req.method),
        }),
      );
    }
    app.get("/v1/health", (context) => writeRuntimeSuccess(context, this.createHealthResponse()));
    app.get("/version", (context) => context.json(this.createVersionResponse()));
    app.get("/capabilities", async (context) => context.json(await this.createCapabilitiesResponse()));
    app.get("/report", async (context) => context.json(await this.createReportResponse()));
    app.get("/v1/providers", (context) => this.listRuntimeProviders(context));
    app.get("/v1/actions", (context) => this.listRuntimeActions(context));
    app.get("/v1/actions/search", (context) => this.searchRuntimeActions(context));
    app.get("/v1/actions/:actionId", (context) => this.getRuntimeAction(context, context.req.param("actionId")));
    app.post("/v1/actions/:actionId", (context) => this.createRuntimeActionRun(context, context.req.param("actionId")));
    app.get("/v1/apps", (context) => this.listRuntimeApps(context));
    app.get("/v1/apps/authenticated", (context) => this.listAuthenticatedRuntimeApps(context));
    app.get("/v1/apps/services/:service", (context) =>
      this.listRuntimeAppsByService(context, context.req.param("service")),
    );
    app.post("/v1/proxy/:service", (context) => this.createRuntimeProxyRequest(context, context.req.param("service")));

    app.get("/openapi.json", (context) =>
      context.json(
        createOpenApiDocument(this.options.catalog.providers, {
          actionId: optionalString(context.req.query("actionId")),
        }),
      ),
    );
    app.get(
      "/docs",
      Scalar({
        pageTitle: "OOMOL Connect API Reference",
        url: "/openapi.json",
        theme: "default",
        darkMode: false,
        forceDarkModeState: "light",
        customCss: `
          :root {
            --scalar-color-accent: rgb(59, 99, 251);
            --scalar-background-accent: rgba(59, 99, 251, 0.12);
          }
        `,
      }),
    );

    app.get("/api/providers", (context) => context.json(this.options.catalog.providers));
    app.get("/api/providers/:service", (context) => this.getProvider(context, context.req.param("service")));

    app.get("/api/actions", (context) => context.json(this.options.catalog.actions));
    app.get("/api/actions/search", (context) => this.searchApiActions(context));
    app.get("/api/actions/:actionId/agent.md", (context) =>
      this.getActionMarkdown(context, context.req.param("actionId")),
    );
    app.get("/api/actions/:actionId", (context) => this.getAction(context, context.req.param("actionId")));
    app.get("/api/auth/session", async (context) => context.json(await readLocalAuthSession(context, auth)));
    app.post("/api/auth/logout", (context) => {
      clearLocalAuthCookie(context);
      return context.json({ ok: true });
    });

    app.get("/api/connections", (context) => this.listConnections(context));
    app.put("/api/connections/:service", (context) => this.upsertConnection(context, context.req.param("service")));
    app.delete("/api/connections/:service", (context) => this.disconnect(context, context.req.param("service")));

    app.get("/api/runs", (context) => this.listRuns(context));
    app.post("/api/files", (context) => this.createTransitFile(context));
    app.get("/api/files/:fileId", (context) => this.getTransitFile(context, context.req.param("fileId")));
    app.delete("/api/files/:fileId", (context) => this.deleteTransitFile(context, context.req.param("fileId")));
    app.get("/api/runtime-tokens", (context) => this.listRuntimeTokens(context));
    app.post("/api/runtime-tokens", (context) => this.createRuntimeToken(context));
    app.delete("/api/runtime-tokens/:id", (context) => this.revokeRuntimeToken(context, context.req.param("id")));
    app.post("/api/service-tokens", (context) => this.createServiceToken(context));
    app.get("/api/oauth/configs", (context) => this.listOAuthConfigs(context));
    app.put("/api/oauth/configs/:service", (context) => this.upsertOAuthConfig(context, context.req.param("service")));
    app.delete("/api/oauth/configs/:service", (context) =>
      this.deleteOAuthConfig(context, context.req.param("service")),
    );
    app.post("/api/oauth/authorizations", (context) => this.createOAuthAuthorization(context));
    app.get("/oauth/callback", (context) => this.completeOAuth(context));
    app.post("/mcp", (context) => this.handleMcp(context));
    app.get("/mcp", (context) => this.rejectMcpMethod(context));
    app.delete("/mcp", (context) => this.rejectMcpMethod(context));
    app.get("/mcp/tools", (context) => context.json({ tools: listMcpToolSummaries() }));

    this.options.registerStaticRoutes?.(app);
    app.onError((error, context) => {
      if (error instanceof HttpRequestError) {
        return jsonError(context, 400, error.code, error.message);
      }
      this.options.logger?.error(
        {
          err: error,
          method: context.req.method,
          path: context.req.path,
        },
        "request failed",
      );
      return internalError(context, error);
    });

    return app;
  }

  private getProvider(context: Context, service: string): Response {
    const provider = this.options.catalog.providers.find((provider) => provider.service === service);
    if (!provider) {
      return notFound(context);
    }

    return context.json(provider);
  }

  private async createRootResponse(): Promise<Record<string, unknown>> {
    const auth = await this.readAuthenticationMetadata();
    return {
      service: "OpenCreds",
      ...this.createVersionResponse(),
      status: "healthy",
      authentication: auth,
      capabilities: {
        providers: this.options.catalog.providers.length > 0,
        oauth: this.options.catalog.providers.some((provider) => provider.authTypes.includes("oauth2")),
        mcp: true,
        runtime_api: true,
      },
      _links: {
        health: "/v1/health",
        openapi: "/openapi.json",
        mcp: "/mcp",
        docs: "/docs",
      },
    };
  }

  private createHealthResponse(): Record<string, unknown> {
    return {
      status: "healthy",
      checks: {
        database: "ok",
        provider_registry: "ok",
        oauth: this.options.catalog.providers.some((provider) => provider.authTypes.includes("oauth2"))
          ? "ok"
          : "disabled",
        mcp: "ok",
      },
    };
  }

  private createVersionResponse(): Record<string, unknown> {
    const version = readVersion();
    const gitCommit = readGitCommit();
    return {
      version,
      ...(gitCommit ? { gitCommit } : {}),
    };
  }

  private async createCapabilitiesResponse(): Promise<Record<string, unknown>> {
    const auth = await this.readAuthenticationMetadata();
    const version = this.createVersionResponse();
    return {
      ...version,
      authentication: {
        ...auth,
        enabledProviders: auth.modes,
      },
      storage: {
        backend: this.options.storageBackend ?? "unknown",
      },
      oauth: {
        enabled: this.options.catalog.providers.some((provider) => provider.authTypes.includes("oauth2")),
      },
      mcp: {
        enabled: true,
      },
      providers: {
        count: this.options.catalog.providers.length,
      },
      actions: {
        count: this.options.catalog.actions.length,
      },
    };
  }

  private async createReportResponse(): Promise<Record<string, unknown>> {
    const auth = await this.readAuthenticationMetadata();
    const buildTimestamp = readBuildTimestamp();
    return {
      ...this.createVersionResponse(),
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000)),
      providerCount: this.options.catalog.providers.length,
      actionCount: this.options.catalog.actions.length,
      storageBackend: this.options.storageBackend ?? "unknown",
      authMode: auth.modes,
      authenticationRequired: auth.required,
      ...(buildTimestamp ? { buildTimestamp } : {}),
    };
  }

  private async readAuthenticationMetadata(): Promise<{ required: boolean; modes: string[]; supported: string[] }> {
    const modes = await listAuthenticationModes(this.options);
    const required = modes.length > 0;
    return { required, modes, supported: modes };
  }

  private async createTransitFile(context: Context): Promise<Response> {
    try {
      const form = await context.req.raw.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return jsonError(context, 400, "invalid_input", "file is required.");
      }
      const upload = await this.options.transitFiles.create(file);
      return context.json(upload);
    } catch (error) {
      return this.handleTransitFileError(context, error);
    }
  }

  private async getTransitFile(context: Context, fileId: string): Promise<Response> {
    try {
      if (this.options.transitFiles.response) {
        return await this.options.transitFiles.response(fileId);
      }

      const file = await this.options.transitFiles.read(fileId);
      return createTransitFileResponse(file);
    } catch (error) {
      return this.handleTransitFileError(context, error);
    }
  }

  private async deleteTransitFile(context: Context, fileId: string): Promise<Response> {
    try {
      const deleted = await this.options.transitFiles.delete(fileId);
      return context.json({ fileId, deleted });
    } catch (error) {
      return this.handleTransitFileError(context, error);
    }
  }

  private handleTransitFileError(context: Context, error: unknown): Response {
    if (error instanceof TransitFileError) {
      return jsonError(context, error.status, error.code, error.message);
    }
    throw error;
  }

  private getAction(context: Context, actionId: string): Response {
    const action = this.options.catalog.actionsById.get(actionId);
    if (!action) {
      return notFound(context);
    }

    return context.json(action);
  }

  private async listRuns(context: Context): Promise<Response> {
    const query = readRunLogListInput(context);
    if (!query.ok) {
      return jsonError(context, 400, "invalid_input", query.message);
    }

    return context.json(await this.options.actions.listRuns(query.input));
  }

  private async searchApiActions(context: Context): Promise<Response> {
    const query = readSearchQuery(context);
    if (!query.ok) {
      return jsonError(context, 400, "invalid_input", query.message);
    }

    const index = await this.actionSearch.get();
    return context.json(
      await this.serializeSearchResults(
        context,
        searchActions(index, query.q, {
          service: query.service,
          limit: query.limit,
        }),
      ),
    );
  }

  private async getActionMarkdown(context: Context, actionId: string): Promise<Response> {
    const action = this.options.catalog.actionsById.get(actionId);
    if (!action) {
      return notFound(context);
    }

    return context.text(
      renderActionMarkdown(action, {
        connection: await this.options.connections.getConnectionSummary(action.service, readConnectionName(context)),
        providerPermissions: action.providerPermissions,
      }),
      200,
      {
        "content-type": "text/markdown; charset=utf-8",
      },
    );
  }

  private listRuntimeProviders(context: Context): Response {
    const services = context.req.queries("service") ?? [];
    const query = optionalString(context.req.query("q"))?.toLowerCase();
    const providers = this.options.catalog.providers.filter((provider) => {
      if (services.length > 0 && !services.includes(provider.service)) {
        return false;
      }
      if (!query) {
        return true;
      }

      return [provider.service, provider.displayName, provider.categories.join(" "), provider.authTypes.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });

    return writeRuntimeSuccess(context, providers.map(serializeRuntimeProvider));
  }

  private listRuntimeActions(context: Context): Response {
    const service = optionalString(context.req.query("service"));
    if (!service) {
      const services = [...new Set(this.options.catalog.actions.map((action) => action.service))];
      return writeRuntimeSuccess(context, services.map(serializeRuntimeActionService));
    }

    const actions = this.options.catalog.actions.filter((action) => action.service === service);
    return writeRuntimeSuccess(context, actions.map(serializeRuntimeAction));
  }

  private async searchRuntimeActions(context: Context): Promise<Response> {
    const query = readSearchQuery(context, 10);
    if (!query.ok) {
      return writeRuntimeFailure(context, {
        status: 400,
        errorCode: "invalid_input",
        message: query.message,
      });
    }

    const index = await this.actionSearch.get();
    const results = searchActions(index, query.q, {
      service: query.service,
      limit: query.limit,
    });
    return writeRuntimeSuccess(context, await this.serializeSearchResults(context, results));
  }

  private async serializeSearchResults(
    context: Context,
    results: ActionSearchResult[],
  ): Promise<RuntimeActionSearchResult[]> {
    const authenticated = new Set(
      await this.options.connections.listAuthenticatedServices(
        [...new Set(results.map((result) => result.service))],
        readIdentityContext(context),
      ),
    );
    return results.flatMap((result) => {
      const action = this.options.catalog.actionsById.get(result.id);
      if (!action) {
        return [];
      }
      return [serializeActionSearchResult(result, action, authenticated.has(action.service))];
    });
  }

  private getRuntimeAction(context: Context, actionId: string): Response {
    const action = this.options.catalog.actionsById.get(actionId);
    if (!action) {
      return writeRuntimeFailure(context, {
        status: 404,
        errorCode: "invalid_input",
        message: `unknown action: ${actionId}`,
        meta: { actionId },
      });
    }

    return writeRuntimeSuccess(context, serializeRuntimeAction(action));
  }

  private async createRuntimeActionRun(context: Context, actionId: string): Promise<Response> {
    if (!this.options.catalog.actionsById.has(actionId)) {
      return writeRuntimeFailure(context, {
        status: 404,
        errorCode: "invalid_input",
        message: `unknown action: ${actionId}`,
        meta: { actionId },
      });
    }

    const body = await readJsonBody(context);
    try {
      const run = await this.options.actions.run({
        actionId,
        input: body.input ?? {},
        caller: "http",
        connectionName: readConnectionName(context, body),
        identity: readIdentityContext(context),
      });
      if (!run) {
        return writeRuntimeFailure(context, {
          status: 404,
          errorCode: "invalid_input",
          message: `unknown action: ${actionId}`,
          meta: { actionId },
        });
      }

      return writeRuntimeActionResult(context, { actionId, executionId: run.executionId, result: run.result });
    } catch (error) {
      if (error instanceof ConnectionError) {
        return writeRuntimeFailure(context, {
          status: mapConnectionErrorStatus(error),
          errorCode: error.code,
          message: error.message,
          meta: { actionId },
        });
      }

      throw error;
    }
  }

  private async createRuntimeProxyRequest(context: Context, service: string): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(context);
    } catch (error) {
      if (error instanceof HttpRequestError) {
        return writeRuntimeFailure(context, {
          status: 400,
          errorCode: "invalid_input",
          message: error.message,
          meta: { service },
        });
      }

      throw error;
    }

    const result = await this.proxyRunner.run({
      service,
      input: body,
      connectionName: readConnectionName(context, body),
      identity: readIdentityContext(context),
    });
    if (result.ok) {
      return writeRuntimeSuccess(context, result.response);
    }

    return writeRuntimeFailure(context, {
      status: result.status,
      errorCode: result.errorCode,
      message: result.message,
      data: result.data,
      meta: result.meta,
    });
  }

  private async listRuntimeApps(context: Context): Promise<Response> {
    return writeRuntimeSuccess(
      context,
      (await this.options.connections.listConnections(readIdentityContext(context))).map(serializeRuntimeConnectedApp),
    );
  }

  private async listRuntimeAppsByService(context: Context, service: string): Promise<Response> {
    try {
      return writeRuntimeSuccess(
        context,
        (await this.options.connections.listConnectionsByService(service, readIdentityContext(context))).map(
          serializeRuntimeConnectedApp,
        ),
      );
    } catch (error) {
      if (error instanceof ConnectionError) {
        return writeRuntimeFailure(context, {
          status: mapConnectionErrorStatus(error),
          errorCode: error.code,
          message: error.message,
          meta: { service },
        });
      }

      throw error;
    }
  }

  private async listAuthenticatedRuntimeApps(context: Context): Promise<Response> {
    const services = context.req.queries("service") ?? [];
    return writeRuntimeSuccess(
      context,
      await this.options.connections.listAuthenticatedServices(services, readIdentityContext(context)),
    );
  }

  private async handleMcp(context: Context): Promise<Response> {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createMcpServer({
      catalog: this.options.catalog,
      providerLoader: this.options.providerLoader,
      connections: this.options.connections,
      actions: this.options.actions,
      actionPolicy: this.options.actionPolicy,
      actionSearch: this.actionSearch,
    });

    await server.connect(transport);
    try {
      return await transport.handleRequest(context.req.raw);
    } finally {
      await server.close();
    }
  }

  private rejectMcpMethod(context: Context): Response {
    return context.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed.",
        },
        id: null,
      },
      405,
    );
  }

  private async listConnections(context: Context): Promise<Response> {
    return context.json(await this.options.connections.listConnections(readIdentityContext(context)));
  }

  private async upsertConnection(context: Context, service: string): Promise<Response> {
    const body = await readJsonBody(context);
    const authType = optionalString(body.authType);
    if (!authType) {
      this.options.logger?.warn(
        {
          errorCode: "invalid_input",
          path: context.req.path,
          service,
        },
        "connection rejected",
      );
      return jsonError(context, 400, "invalid_input", "authType is required.");
    }

    const values = body.values ?? body;
    const connectionName = readConnectionName(context, body);
    const logContext: ConnectionLogContext = {
      operation: "connect",
      path: context.req.path,
      service,
      authType,
      connectionName,
    };
    if (authType === "no_auth") {
      this.options.logger?.info(logContext, "connection started");
      return this.writeConnectionResult(
        context,
        this.options.connections.connectWithoutAuth(service, {
          connectionName,
          identity: readIdentityContext(context),
        }),
        logContext,
      );
    }
    if (authType === "api_key") {
      this.options.logger?.info(logContext, "connection started");
      return this.writeConnectionResult(
        context,
        this.options.connections.connectWithApiKey(service, {
          values,
          connectionName,
          identity: readIdentityContext(context),
        }),
        logContext,
      );
    }
    if (authType === "custom_credential") {
      this.options.logger?.info(logContext, "connection started");
      return this.writeConnectionResult(
        context,
        this.options.connections.connectWithCustomCredential(service, {
          values,
          connectionName,
          identity: readIdentityContext(context),
        }),
        logContext,
      );
    }

    this.options.logger?.warn(
      {
        ...logContext,
        errorCode: "unsupported_auth_type",
      },
      "connection rejected",
    );
    return jsonError(context, 400, "unsupported_auth_type", `${service} does not support ${authType}.`);
  }

  private async disconnect(context: Context, service: string): Promise<Response> {
    const body = context.req.header("content-type")?.includes("application/json") ? await readJsonBody(context) : {};
    const connectionName = readConnectionName(context, body);
    const logContext: ConnectionLogContext = {
      operation: "disconnect",
      path: context.req.path,
      service,
      connectionName,
    };
    this.options.logger?.info(logContext, "connection disconnect started");
    return this.writeConnectionResult(
      context,
      this.options.connections.disconnect(service, connectionName, readIdentityContext(context)),
      logContext,
    );
  }

  private async createOAuthAuthorization(context: Context): Promise<Response> {
    const body = await readJsonBody(context);
    const requestedService = optionalString(body.service);
    const connectionName = readConnectionName(context, body);
    try {
      const service = requiredString(
        body.service,
        "service",
        (message) => new OAuthFlowError("invalid_input", message),
      );
      const logContext = {
        path: context.req.path,
        service,
        connectionName,
      };
      this.options.logger?.info(logContext, "oauth authorization started");

      const authorization = await this.options.oauthFlow.startAuthorization({
        service,
        connectionName,
        identity: readIdentityContext(context),
      });
      const authorizationUrl = new URL(authorization.authorizationUrl);
      this.options.logger?.info(
        {
          ...logContext,
          authorizationHost: authorizationUrl.host,
          redirectUri: authorizationUrl.searchParams.get("redirect_uri") ?? undefined,
        },
        "oauth authorization created",
      );
      return context.json(authorization);
    } catch (error) {
      if (error instanceof OAuthFlowError) {
        this.options.logger?.warn(
          {
            errorCode: error.code,
            path: context.req.path,
            service: requestedService,
            connectionName,
          },
          "oauth authorization failed",
        );
        return jsonError(context, error.code === "unknown_service" ? 404 : 400, error.code, error.message);
      }

      throw error;
    }
  }

  private async listRuntimeTokens(context: Context): Promise<Response> {
    return context.json(await this.options.runtimeTokens.listTokens(readIdentityContext(context)));
  }

  private async createRuntimeToken(context: Context): Promise<Response> {
    const body = await readJsonBody(context);
    const name = optionalString(body.name);
    if (!name) {
      return jsonError(context, 400, "invalid_input", "name is required.");
    }

    const created = await this.options.runtimeTokens.createToken(name, readIdentityContext(context));
    return context.json({
      token: created.token,
      record: {
        id: created.record.id,
        name: created.record.name,
        createdAt: created.record.createdAt,
      },
    });
  }

  private async createServiceToken(context: Context): Promise<Response> {
    const body = await readJsonBody(context);
    const name = optionalString(body.name);
    if (!name) {
      return jsonError(context, 400, "invalid_input", "name is required.");
    }
    const created = await this.options.runtimeTokens.createServiceToken(name, readIdentityContext(context));
    return context.json({
      token: created.token,
      record: {
        id: created.record.id,
        name: created.record.name,
        createdAt: created.record.createdAt,
      },
    });
  }

  private async revokeRuntimeToken(context: Context, id: string): Promise<Response> {
    if (!(await this.options.runtimeTokens.revokeToken(id, readIdentityContext(context)))) {
      return jsonError(context, 404, "runtime_token_not_found", `Runtime token not found: ${id}.`);
    }

    return context.json({ id, revoked: true });
  }

  private async listOAuthConfigs(context: Context): Promise<Response> {
    return context.json(await this.options.oauthClientConfigs.listConfigs());
  }

  private async upsertOAuthConfig(context: Context, service: string): Promise<Response> {
    const body = await readJsonBody(context);
    return this.writeOAuthResult(
      context,
      this.options.oauthClientConfigs.upsertConfig({
        service,
        clientId: optionalString(body.clientId) ?? "",
        clientSecret: optionalString(body.clientSecret) ?? "",
        extra: optionalRecord(body.extra),
        secretExtra: optionalRecord(body.secretExtra),
      }),
    );
  }

  private async deleteOAuthConfig(context: Context, service: string): Promise<Response> {
    return this.writeOAuthResult(context, this.options.oauthClientConfigs.deleteConfig(service));
  }

  private async completeOAuth(context: Context): Promise<Response> {
    const state = context.req.query("state");
    const code = context.req.query("code");
    const logContext = {
      path: context.req.path,
      hasState: Boolean(state),
      hasCode: Boolean(code),
    };
    this.options.logger?.info(logContext, "oauth callback received");
    if (!state || !code) {
      this.options.logger?.warn(
        {
          ...logContext,
          errorCode: "invalid_oauth_callback",
        },
        "oauth callback failed",
      );
      return jsonError(context, 400, "invalid_oauth_callback", "OAuth callback requires state and code.");
    }

    let service: string;
    try {
      service = (await this.options.oauthFlow.completeAuthorization({ state, code })).service;
      this.options.logger?.info(
        {
          ...logContext,
          service,
        },
        "oauth callback completed",
      );
    } catch (error) {
      if (error instanceof OAuthFlowError) {
        this.options.logger?.warn(
          {
            ...logContext,
            errorCode: error.code,
          },
          "oauth callback failed",
        );
        return jsonError(context, 400, error.code, error.message);
      }
      throw error;
    }

    return context.html(renderOAuthCompletionPage(service));
  }

  private async writeConnectionResult(
    context: Context,
    operation: Promise<unknown>,
    logContext?: ConnectionLogContext,
  ): Promise<Response> {
    try {
      const result = await operation;
      if (logContext) {
        this.options.logger?.info(
          logContext,
          logContext.operation === "disconnect" ? "connection disconnect completed" : "connection completed",
        );
      }
      return context.json(result);
    } catch (error) {
      if (error instanceof ConnectionError) {
        if (logContext) {
          this.options.logger?.warn(
            {
              ...logContext,
              errorCode: error.code,
            },
            logContext.operation === "disconnect" ? "connection disconnect failed" : "connection failed",
          );
        }
        return jsonError(context, error.code === "unknown_service" ? 404 : 400, error.code, error.message);
      }

      throw error;
    }
  }

  private async writeOAuthResult(context: Context, operation: Promise<unknown>): Promise<Response> {
    try {
      return context.json(await operation);
    } catch (error) {
      if (error instanceof OAuthClientConfigError || error instanceof OAuthFlowError) {
        return jsonError(context, error.code === "unknown_service" ? 404 : 400, error.code, error.message);
      }
      if (error instanceof HttpRequestError) {
        return jsonError(context, 400, error.code, error.message);
      }

      throw error;
    }
  }
}

interface ConnectionLogContext {
  operation: "connect" | "disconnect";
  path: string;
  service: string;
  authType?: string;
  connectionName?: string;
}

function readConnectionName(context: Context, body?: Record<string, unknown>): string | undefined {
  return (
    optionalString(body?.connectionName) ??
    optionalString(body?.alias) ??
    optionalString(context.req.header("x-oomol-connector-alias")) ??
    optionalString(context.req.header("x-oo-connector-alias")) ??
    optionalString(context.req.query("connectionName")) ??
    optionalString(context.req.query("alias"))
  );
}

function shouldAuthenticateRequest(path: string, method: string): boolean {
  return !(
    (method === "GET" && path === "/") ||
    (method === "GET" && path === "/health") ||
    (method === "GET" && path === "/v1/health") ||
    (method === "GET" && path === "/version") ||
    (method === "GET" && path === "/capabilities") ||
    (method === "GET" && path === "/report") ||
    (method === "GET" && path === "/openapi.json") ||
    (method === "GET" && path === "/mcp/tools") ||
    path === "/oauth/callback" ||
    path.startsWith("/oauth/callback/") ||
    (method === "GET" && path === "/api/auth/session") ||
    (method === "POST" && path === "/api/auth/logout") ||
    (method === "GET" && path.startsWith("/api/files/"))
  );
}

async function listAuthenticationModes(options: IConnectServerOptions): Promise<string[]> {
  const modes = new Set<string>();
  for (const mode of authModesForAuthMode(options.authMode)) {
    modes.add(mode);
  }

  if (options.auth?.adminToken) {
    modes.add("service-token");
  }
  if (options.auth?.runtimeToken || (await (options.auth?.hasRuntimeTokens?.() ?? false))) {
    modes.add("runtime-token");
  }
  return [...modes];
}

function authModesForAuthMode(mode: AuthMode | undefined): readonly string[] {
  if (mode === "runtime-token") {
    return ["runtime-token"];
  }
  if (mode === "jwt") {
    return ["jwt"];
  }
  if (mode === "proxy") {
    return ["service-token"];
  }
  if (mode === "hybrid") {
    return ["jwt", "runtime-token", "service-token"];
  }
  return [];
}

function readVersion(): string {
  return readEnvironmentVariable("OPENCREDS_VERSION") ?? readEnvironmentVariable("npm_package_version") ?? "0.0.0";
}

function readGitCommit(): string | undefined {
  return optionalString(readEnvironmentVariable("OPENCREDS_GIT_COMMIT"));
}

function readBuildTimestamp(): string | undefined {
  return optionalString(readEnvironmentVariable("OPENCREDS_BUILD_TIMESTAMP"));
}

function readEnvironmentVariable(name: string): string | undefined {
  if (typeof process !== "object" || !process || typeof process.env !== "object" || !process.env) {
    return undefined;
  }
  return process.env[name];
}

type SearchQuery =
  | {
      ok: true;
      q: string;
      service?: string;
      limit: number;
    }
  | {
      ok: false;
      message: string;
    };

type RunLogListQuery =
  | {
      ok: true;
      input: RunLogListInput;
    }
  | {
      ok: false;
      message: string;
    };

interface RuntimeActionSearchResult {
  id: string;
  service: string;
  name: string;
  description: string;
  authenticated: boolean;
  inputSchema: RuntimeActionDefinition["inputSchema"];
  outputSchema: RuntimeActionDefinition["outputSchema"];
}

function serializeActionSearchResult(
  result: ActionSearchResult,
  action: RuntimeActionDefinition,
  authenticated: boolean,
): RuntimeActionSearchResult {
  return {
    id: result.id,
    service: result.service,
    name: result.name,
    description: result.description,
    authenticated,
    inputSchema: action.inputSchema,
    outputSchema: action.outputSchema,
  };
}

function readRunLogListInput(context: Context): RunLogListQuery {
  const rawLimit = optionalString(context.req.query("limit"));
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, message: "limit must be an integer between 1 and 100." };
  }

  const cursor = optionalString(context.req.query("cursor"));
  if (cursor !== undefined) {
    try {
      decodeRunLogCursor(cursor);
    } catch {
      return { ok: false, message: "cursor is invalid." };
    }
  }

  const input: RunLogListInput = { limit };
  if (cursor !== undefined) {
    input.cursor = cursor;
  }
  const service = optionalString(context.req.query("service"));
  if (service !== undefined) {
    input.service = service;
  }

  return { ok: true, input };
}

function readSearchQuery(context: Context, defaultLimit = DEFAULT_ACTION_SEARCH_LIMIT): SearchQuery {
  const q = optionalString(context.req.query("q") ?? context.req.query("query"));
  if (!q || q.length > 256) {
    return { ok: false, message: "q must be a non-empty string of at most 256 characters." };
  }

  const rawLimit = optionalString(context.req.query("limit"));
  if (!rawLimit) {
    return {
      ok: true,
      q,
      service: optionalString(context.req.query("service")),
      limit: defaultLimit,
    };
  }

  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return { ok: false, message: "limit must be an integer between 1 and 50." };
  }

  return {
    ok: true,
    q,
    service: optionalString(context.req.query("service")),
    limit,
  };
}
