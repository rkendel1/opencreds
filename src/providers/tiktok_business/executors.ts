import type { CredentialValidators, ProviderExecutors } from "../../core/types.ts";

import { defineBearerProviderExecutors } from "../provider-runtime.ts";
import { tiktokBusinessActionHandlers, validateTikTokBusinessCredential } from "./runtime.ts";

export const executors: ProviderExecutors = defineBearerProviderExecutors(
  "tiktok_business",
  tiktokBusinessActionHandlers,
);

export const credentialValidators: CredentialValidators = {
  apiKey(input, { fetcher }): ReturnType<typeof validateTikTokBusinessCredential> {
    return validateTikTokBusinessCredential(
      {
        accessToken: input.apiKey,
        metadata: {},
      },
      fetcher,
    );
  },
};
