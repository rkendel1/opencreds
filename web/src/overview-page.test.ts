import type { AppData, RunLog } from "./model";

import { I18nProvider } from "@embra/i18n/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "./i18n";
import { OverviewPage } from "./overview-page";

describe("OverviewPage", () => {
  it("marks run summaries as compact data tables", () => {
    const markup = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { i18n: createAppI18n("en") },
        createElement(MemoryRouter, {}, createElement(OverviewPage, { data: overviewData, onRefresh() {} })),
      ),
    );

    expect(markup.match(/class="summary-table"/g) ?? []).toHaveLength(2);
  });
});

const overviewData: AppData = {
  providers: [],
  connections: [],
  oauthConfigs: [],
  runtimeTokens: [],
  runs: [
    run("failed", false),
    run("success-1", true),
    run("success-2", true),
    run("success-3", true),
    run("success-4", true),
    run("success-5", true),
  ],
};

function run(id: string, ok: boolean): RunLog {
  return {
    id,
    actionId: ok ? "hackernews.get_best_stories" : "notion.append_block",
    caller: "web",
    startedAt: "2026-07-06T09:00:00.000Z",
    completedAt: "2026-07-06T09:00:00.727Z",
    durationMs: 727,
    ok,
    inputSummary: {},
  };
}
