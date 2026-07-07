import type { IConnectionStore, StoredConnection } from "../../connection-service.ts";
import type { ActionDefinition, ActionExecutor, ProviderDefinition, ResolvedCredential } from "../../core/types.ts";
import type { IProviderLoader } from "../../providers/provider-loader.ts";
import type { IRunLogStore, RunLogPage } from "../storage/runtime-store.ts";

import { describe, expect, it } from "vitest";
import { createCatalogStore } from "../../catalog-store.ts";
import { ConnectionService } from "../../connection-service.ts";
import { ActionRunner } from "./action-runner.ts";
import { AwaitActionRunner } from "./await-action-runner.ts";

const startAction: ActionDefinition = {
  id: "async_demo.start_job",
  service: "async_demo",
  name: "start_job",
  description: "Start a demo async job.",
  requiredScopes: [],
  providerPermissions: [],
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  asyncLifecycle: {
    startActionId: "async_demo.start_job",
    statusActionId: "async_demo.get_job",
    cancelActionId: "async_demo.cancel_job",
    jobIdOutputPath: "job.id",
    jobIdInputField: "job_id",
    completionPath: "status",
    completionValues: { done: ["completed"], failed: ["failed"] },
  },
};

const statusAction: ActionDefinition = {
  id: "async_demo.get_job",
  service: "async_demo",
  name: "get_job",
  description: "Get demo async job status.",
  requiredScopes: [],
  providerPermissions: [],
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
};

const cancelAction: ActionDefinition = {
  id: "async_demo.cancel_job",
  service: "async_demo",
  name: "cancel_job",
  description: "Cancel a demo async job.",
  requiredScopes: [],
  providerPermissions: [],
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
};

const notPollableAction: ActionDefinition = {
  id: "async_demo.start_unmapped",
  service: "async_demo",
  name: "start_unmapped",
  description: "Async action without full field mapping.",
  requiredScopes: [],
  providerPermissions: [],
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  asyncLifecycle: {
    startActionId: "async_demo.start_unmapped",
    statusActionId: "async_demo.get_job",
  },
};

const demoProvider: ProviderDefinition = {
  service: "async_demo",
  displayName: "Async Demo",
  categories: ["Developer Tools"],
  authTypes: ["no_auth"],
  auth: [{ type: "no_auth" }],
  actions: [startAction, statusAction, cancelAction, notPollableAction],
};

describe("AwaitActionRunner", () => {
  it("returns not_pollable for actions without a full field mapping", async () => {
    const { runner } = createRunner({ statusSequence: [] });

    const result = await runner.run({ actionId: "async_demo.start_unmapped", input: {}, caller: "http" });

    expect(result).toEqual({ kind: "not_pollable" });
  });

  it("settles immediately when the first status poll is already done", async () => {
    const { runner } = createRunner({ statusSequence: [{ status: "completed", output: "done" }] });

    const result = await runner.run({ actionId: "async_demo.start_job", input: {}, caller: "http" });

    expect(result?.kind).toBe("settled");
    expect(result?.kind === "settled" && result.result).toEqual({
      ok: true,
      output: { status: "completed", output: "done" },
    });
  });

  it("polls through pending states before settling", async () => {
    const { runner, statusCalls } = createRunner({
      statusSequence: [{ status: "in_progress" }, { status: "in_progress" }, { status: "completed", output: "done" }],
    });

    const result = await runner.run({ actionId: "async_demo.start_job", input: {}, caller: "http" });

    expect(result?.kind).toBe("settled");
    expect(statusCalls).toHaveLength(3);
    expect(statusCalls[0]).toEqual({ job_id: "job-1" });
  });

  it("returns a structured error when the status reports a terminal failure", async () => {
    const { runner } = createRunner({ statusSequence: [{ status: "failed" }] });

    const result = await runner.run({ actionId: "async_demo.start_job", input: {}, caller: "http" });

    expect(result?.kind).toBe("settled");
    expect(result?.kind === "settled" && result.result).toEqual({
      ok: false,
      error: {
        code: "async_action_failed",
        message: "async_demo reported a terminal failure status: failed.",
        details: { status: "failed" },
      },
    });
  });

  it("returns pending once the wait budget is exhausted", async () => {
    const { runner } = createRunner({
      statusSequence: [{ status: "in_progress" }, { status: "in_progress" }, { status: "in_progress" }],
    });

    const result = await runner.run({ actionId: "async_demo.start_job", input: {}, caller: "http", maxWaitMs: 2 });

    expect(result).toEqual({
      kind: "pending",
      executionId: expect.any(String),
      jobId: "job-1",
      statusActionId: "async_demo.get_job",
    });
  });

  it("returns job_id_extraction_failed when the start output has no job id", async () => {
    const { runner } = createRunner({ statusSequence: [], startOutput: {} });

    const result = await runner.run({ actionId: "async_demo.start_job", input: {}, caller: "http" });

    expect(result?.kind).toBe("settled");
    expect(result?.kind === "settled" && result.result.ok).toBe(false);
    expect(result?.kind === "settled" && result.result.error?.code).toBe("job_id_extraction_failed");
  });
});

function createRunner(options: {
  statusSequence: Array<Record<string, unknown>>;
  startOutput?: Record<string, unknown>;
}): { runner: AwaitActionRunner; statusCalls: Array<Record<string, unknown>> } {
  const catalog = createCatalogStore([demoProvider], {
    executableActionIds: [
      "async_demo.start_job",
      "async_demo.get_job",
      "async_demo.cancel_job",
      "async_demo.start_unmapped",
    ],
  });
  const statusCalls: Array<Record<string, unknown>> = [];
  let statusIndex = 0;
  const startOutput = options.startOutput ?? { job: { id: "job-1" } };

  const providerLoader: IProviderLoader = {
    async loadActionExecutor(_service, actionId): Promise<ActionExecutor> {
      if (actionId === "async_demo.start_job" || actionId === "async_demo.start_unmapped") {
        return async () => ({ ok: true, output: startOutput });
      }
      if (actionId === "async_demo.get_job") {
        return async (input) => {
          statusCalls.push(input as Record<string, unknown>);
          const next = options.statusSequence[statusIndex];
          statusIndex += 1;
          return { ok: true, output: next };
        };
      }
      return async () => ({ ok: true, output: {} });
    },
    async loadProxyExecutor(): Promise<undefined> {
      return undefined;
    },
    async loadCredentialValidators(): Promise<undefined> {
      return undefined;
    },
  };

  const connections = new ConnectionService({ catalog, providerLoader, store: new MemoryConnectionStore() });
  const actions = new ActionRunner({ catalog, providerLoader, connections, runs: new MemoryRunLogStore() });
  const runner = new AwaitActionRunner({
    catalog,
    actions,
    now: makeFakeClock(),
    sleep: async () => {},
  });

  return { runner, statusCalls };
}

function makeFakeClock(): () => number {
  let current = 0;
  return () => {
    current += 1;
    return current;
  };
}

class MemoryConnectionStore implements IConnectionStore {
  async get(): Promise<ResolvedCredential | undefined> {
    return undefined;
  }

  async set(): Promise<void> {}

  async delete(): Promise<void> {}

  async list(): Promise<StoredConnection[]> {
    return [];
  }
}

class MemoryRunLogStore implements IRunLogStore {
  async add(): Promise<void> {}

  async list(): Promise<RunLogPage> {
    return { items: [] };
  }
}
