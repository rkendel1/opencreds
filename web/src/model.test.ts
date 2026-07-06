import type { ProviderDefinition } from "./model";

import { describe, expect, it } from "vitest";
import { sortProviders } from "./model";

function provider(service: string, displayName: string): ProviderDefinition {
  return {
    service,
    displayName,
    categories: [],
    authTypes: ["no_auth"],
    auth: [{ type: "no_auth" }],
    actions: [],
  };
}

describe("sortProviders", () => {
  it("keeps fusion-api first before connection and display-name ordering", () => {
    const providers = [
      provider("github", "GitHub"),
      provider("fusion-api", "OOMOL Fusion API"),
      provider("airtable", "Airtable"),
    ];
    const connections = new Map([["github", { service: "github", authType: "oauth2", metadata: {} }]]);

    expect(sortProviders(providers, connections).map((item) => item.service)).toEqual([
      "fusion-api",
      "github",
      "airtable",
    ]);
  });
});
