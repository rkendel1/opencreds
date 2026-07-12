import type { AuthMode, IAuthProvider } from "../auth/auth-provider.ts";
import type { CatalogStore } from "../catalog-store.ts";
import type { ActionPolicyService } from "../core/action-policy.ts";
import type { IProviderLoader } from "../providers/provider-loader.ts";
import type { ITransitFileService } from "./files/transit-file-store.ts";
import type { Logger } from "./logger.ts";
import type { ISecretCodec } from "./secrets/secret-codec-core.ts";
import type { RuntimeDatabase } from "./storage/runtime-database.ts";
import type { Hono } from "hono";

import { AnonymousAuthProvider } from "../auth/anonymous-provider.ts";
import { HybridAuthProvider } from "../auth/auth-provider.ts";
import { JwtAuthProvider } from "../auth/jwt-provider.ts";
import { ProxyAuthProvider } from "../auth/proxy-provider.ts";
import { RuntimeTokenAuthProvider } from "../auth/runtime-token-provider.ts";
import { ConnectionService } from "../connection-service.ts";
import { OAuthClientConfigService } from "../oauth/oauth-client-config-service.ts";
import { OAuthCredentialRefreshService } from "../oauth/oauth-credential-refresh-service.ts";
import { OAuthFlowService } from "../oauth/oauth-flow-service.ts";
import { ActionRunner } from "./actions/action-runner.ts";
import { ConnectServer } from "./connect-server.ts";
import { RuntimeTokenService } from "./storage/runtime-token-service.ts";

export interface ConnectAppOptions {
  catalog: CatalogStore;
  providerLoader: IProviderLoader;
  runtimeDatabase: RuntimeDatabase;
  transitFiles: ITransitFileService;
  publicOrigin: string;
  secretCodec: ISecretCodec;
  adminToken?: string;
  runtimeToken?: string;
  authMode?: AuthMode;
  storageBackend?: string;
  jwtSecret?: string;
  jwtIssuer?: string;
  jwtAudience?: string;
  trustedProxy?: boolean;
  anonymousAuthEnabled?: boolean;
  actionPolicy?: ActionPolicyService;
  registerStaticRoutes?: (app: Hono) => void;
  logger?: Logger;
  computeRuntimeAuthConfigured?: boolean;
}

export interface ConnectApp {
  app: Hono;
  runtimeAuthConfigured: boolean;
}

export async function createConnectApp(options: ConnectAppOptions): Promise<ConnectApp> {
  const mode = options.authMode ?? "anonymous";
  const runtimeTokens = new RuntimeTokenService(options.runtimeDatabase.runtimeTokenStore);
  const hasStoredRuntimeTokens = async (): Promise<boolean> => (await runtimeTokens.listTokens()).length > 0;
  const oauthClientConfigs = new OAuthClientConfigService({
    catalog: options.catalog,
    origin: options.publicOrigin,
    store: options.runtimeDatabase.oauthClientConfigStore,
  });
  const connections = new ConnectionService({
    catalog: options.catalog,
    oauthCredentials: new OAuthCredentialRefreshService(oauthClientConfigs),
    providerLoader: options.providerLoader,
    store: options.runtimeDatabase.connectionStore,
    logger: options.logger,
  });
  const actions = new ActionRunner({
    catalog: options.catalog,
    providerLoader: options.providerLoader,
    connections,
    runs: options.runtimeDatabase.runLogStore,
    transitFiles: options.transitFiles,
    actionPolicy: options.actionPolicy,
    logger: options.logger,
  });
  const authProvider = createAuthProvider(options, runtimeTokens, mode);

  return {
    app: new ConnectServer({
      catalog: options.catalog,
      providerLoader: options.providerLoader,
      connections,
      oauthClientConfigs,
      oauthFlow: new OAuthFlowService({
        clientConfigs: oauthClientConfigs,
        connections,
        states: options.runtimeDatabase.oauthStateStore,
      }),
      actions,
      transitFiles: options.transitFiles,
      runtimeTokens,
      registerStaticRoutes: options.registerStaticRoutes,
      auth: {
        adminToken: options.adminToken,
        runtimeToken: options.runtimeToken,
        hasRuntimeTokens: hasStoredRuntimeTokens,
        verifyRuntimeToken: (token) => runtimeTokens.verifyToken(token),
      },
      authProvider,
      authMode: mode,
      storageBackend: options.storageBackend,
      actionPolicy: options.actionPolicy,
      logger: options.logger,
    }).createApp(),
    runtimeAuthConfigured:
      Boolean(options.runtimeToken) ||
      (options.computeRuntimeAuthConfigured === false ? false : await hasStoredRuntimeTokens()),
  };
}

function createAuthProvider(
  options: ConnectAppOptions,
  runtimeTokens: RuntimeTokenService,
  mode: AuthMode,
): IAuthProvider {
  if (mode === "runtime-token") {
    return new RuntimeTokenAuthProvider({ tokens: runtimeTokens });
  }
  if (mode === "jwt") {
    return new JwtAuthProvider({
      secret: options.jwtSecret,
      issuer: options.jwtIssuer,
      audience: options.jwtAudience,
    });
  }
  if (mode === "proxy") {
    return new ProxyAuthProvider({ trustedProxy: options.trustedProxy });
  }
  if (mode === "hybrid") {
    return new HybridAuthProvider([
      new JwtAuthProvider({
        secret: options.jwtSecret,
        issuer: options.jwtIssuer,
        audience: options.jwtAudience,
        required: false,
      }),
      new RuntimeTokenAuthProvider({
        tokens: runtimeTokens,
        required: false,
      }),
      new ProxyAuthProvider({
        trustedProxy: options.trustedProxy,
        required: false,
      }),
      new AnonymousAuthProvider({ enabled: options.anonymousAuthEnabled ?? true }),
    ]);
  }
  return new AnonymousAuthProvider({ enabled: options.anonymousAuthEnabled ?? true });
}
