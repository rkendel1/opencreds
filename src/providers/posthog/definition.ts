import type { ProviderDefinition } from "../../core/types.ts";

import { posthogActions } from "./actions.ts";

const service = "posthog";

export const provider: ProviderDefinition = {
  service,
  displayName: "PostHog",
  categories: ["Data", "Developer Tools"],
  authTypes: ["api_key"],
  auth: [
    {
      type: "api_key",
      label: "Personal API Key",
      placeholder: "phx_...",
      description:
        "PostHog personal API key used with the Authorization Bearer header. Create or manage it at https://us.posthog.com/settings/user-api-keys or https://eu.posthog.com/settings/user-api-keys.",
      extraFields: [
        {
          key: "baseUrl",
          label: "Base URL",
          inputType: "text",
          required: true,
          secret: false,
          placeholder: "https://us.posthog.com",
          description:
            "PostHog private API base URL, such as https://us.posthog.com, https://eu.posthog.com, or your self-hosted domain.",
        },
      ],
    },
  ],
  homepageUrl: "https://posthog.com",
  actions: posthogActions,
};
