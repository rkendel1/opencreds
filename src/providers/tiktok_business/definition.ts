import type { ProviderDefinition } from "../../core/types.ts";

import { tiktokBusinessActions } from "./actions.ts";

export const provider: ProviderDefinition = {
  service: "tiktok_business",
  displayName: "TikTok Business",
  categories: ["Marketing", "Data"],
  authTypes: ["api_key"],
  auth: [
    {
      type: "api_key",
      label: "Access Token",
      placeholder: "tiktok_business_access_token",
      description:
        "TikTok Business access token sent with the Access-Token header. The token needs advertiser.read, Ad management, Data reports, and GMV Max related permissions for the selected actions.",
      extraFields: [],
    },
  ],
  homepageUrl: "https://business.tiktok.com",
  actions: tiktokBusinessActions,
};
