import type {
  CredentialValidators,
  CredentialValidationResult,
  ExecutionContext,
  ProviderExecutors,
} from "../../core/types.ts";
import type { TwitterActionContext } from "./runtime.ts";

import { defineProviderExecutors, ProviderRequestError } from "../provider-runtime.ts";
import { fetchTwitterCurrentAccount, twitterActionHandlers } from "./runtime.ts";

const service = "twitter";

export const executors: ProviderExecutors = defineProviderExecutors<TwitterActionContext>({
  service,
  handlers: twitterActionHandlers,
  async createContext(context: ExecutionContext, fetcher: typeof fetch): Promise<TwitterActionContext> {
    const credential = await context.getCredential(service);
    if (credential?.authType !== "custom_credential") {
      throw new ProviderRequestError(401, "Configure twitter custom credentials first.");
    }

    return {
      userAccessToken: credential.values.userAccessToken,
      appBearerToken: credential.values.appBearerToken,
      fetcher,
      signal: context.signal,
    };
  },
});

export const credentialValidators: CredentialValidators = {
  async customCredential(input, { fetcher, signal }): Promise<CredentialValidationResult> {
    const userAccessToken = input.values.userAccessToken?.trim();
    if (userAccessToken) {
      return fetchTwitterCurrentAccount(userAccessToken, fetcher, signal);
    }

    if (input.values.appBearerToken?.trim()) {
      return {
        profile: {
          accountId: "twitter:app_bearer_token",
          displayName: "X App Bearer Token",
        },
        grantedScopes: [],
        metadata: {
          credentialMode: "app_bearer_token",
        },
      };
    }

    throw new ProviderRequestError(401, "Configure a twitter user access token or app bearer token first.");
  },
};
