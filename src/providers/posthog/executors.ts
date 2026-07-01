import type { CredentialValidators, ProviderExecutors } from "../../core/types.ts";
import type { PosthogRuntimeContext } from "./runtime.ts";

import { defineProviderExecutors, ProviderRequestError, requireApiKeyCredential } from "../provider-runtime.ts";
import { posthogActionHandlers, validatePosthogCredential } from "./runtime.ts";

const service = "posthog";

const posthogExecutorHandlers = Object.fromEntries(
  Object.entries(posthogActionHandlers).map(([actionName, handler]) => [
    actionName,
    async (input: Record<string, unknown>, context: PosthogRuntimeContext): Promise<unknown> =>
      handler(
        {
          actionName,
          input,
          apiKey: context.apiKey,
          providerMetadata: context.providerMetadata,
        },
        context.fetcher,
      ),
  ]),
);

export const executors: ProviderExecutors = defineProviderExecutors<PosthogRuntimeContext>({
  service,
  handlers: posthogExecutorHandlers,
  fallbackMessage: "PostHog request failed.",
  async createContext(context, fetcher): Promise<PosthogRuntimeContext> {
    const credential = await requireApiKeyCredential(context, service);
    return {
      apiKey: credential.apiKey,
      fetcher,
      providerMetadata: {
        ...credential.metadata,
        baseUrl: credential.metadata.baseUrl ?? credential.values.baseUrl,
        organizationId: credential.metadata.organizationId,
      },
    };
  },
});

export const credentialValidators: CredentialValidators = {
  async apiKey(input, options) {
    try {
      return await validatePosthogCredential(input, options.fetcher);
    } catch (error) {
      if (error instanceof ProviderRequestError) {
        throw error;
      }
      throw new ProviderRequestError(
        502,
        error instanceof Error ? error.message : "PostHog credential validation failed",
      );
    }
  },
};
