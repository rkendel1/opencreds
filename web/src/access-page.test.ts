import type { RuntimeTokenCreation } from "./model";

import { describe, expect, it } from "vitest";
import { createTokenDialogMode } from "./access-page";

describe("createTokenDialogMode", () => {
  it("shows the form before a token is created", () => {
    expect(createTokenDialogMode(null)).toBe("form");
  });

  it("shows the created token after a token is created", () => {
    const created: RuntimeTokenCreation = {
      token: "oomol_test_token",
      record: {
        id: "token_1",
        name: "Local MCP client",
        createdAt: "2026-07-03T00:00:00.000Z",
      },
    };

    expect(createTokenDialogMode(created)).toBe("created");
  });
});
