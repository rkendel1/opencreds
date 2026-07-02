import type { ProviderDefinition } from "../../core/types.ts";

import { twitterActions } from "./actions.ts";

const service = "twitter";

export const provider: ProviderDefinition = {
  service,
  displayName: "X (Twitter)",
  categories: ["Social", "Marketing"],
  authTypes: ["custom_credential"],
  auth: [
    {
      type: "custom_credential",
      fields: [
        {
          key: "userAccessToken",
          label: "User Access Token",
          inputType: "password",
          required: false,
          secret: true,
          placeholder: "twitter_oauth2_user_access_token",
          description:
            "X OAuth 2.0 user access token sent with the Authorization Bearer header. The token must include the action's required X user scopes.",
        },
        {
          key: "appBearerToken",
          label: "App Bearer Token",
          inputType: "password",
          required: false,
          secret: true,
          placeholder: "twitter_app_bearer_token",
          description: "Optional X app-only bearer token used by full archive search and compliance job actions.",
        },
      ],
      testAction: {
        actionName: "user_lookup_me",
        input: {},
      },
    },
  ],
  homepageUrl: "https://x.com",
  actions: twitterActions,
};
