import type { CatalogStore } from "../../catalog-store.ts";
import type { PollableAsyncLifecycle } from "../../core/async-lifecycle.ts";
import type { ExecutionResult } from "../../core/types.ts";
import type { RunLogCaller } from "../storage/runtime-store.ts";
import type { ActionRunner } from "./action-runner.ts";

import { isPollableAsyncLifecycle } from "../../core/async-lifecycle.ts";
import { readPath } from "../../core/cast.ts";

const defaultMaxWaitMs = 25_000;
const maxWaitMsCap = 55_000;
const minWaitMs = 1_000;
const initialPollDelayMs = 1_000;
const maxPollDelayMs = 5_000;
const pollBackoffMultiplier = 1.5;

export interface AwaitActionInput {
  actionId: string;
  input: unknown;
  caller: RunLogCaller;
  connectionName?: string;
  maxWaitMs?: number;
  signal?: AbortSignal;
}

export type AwaitActionResult =
  | { kind: "settled"; executionId: string; result: ExecutionResult }
  | { kind: "pending"; executionId: string; jobId: string; statusActionId: string }
  | { kind: "not_pollable" };

export interface AwaitActionRunnerOptions {
  catalog: CatalogStore;
  actions: ActionRunner;
  /** Injectable clock, defaults to Date.now. Tests supply a fake to avoid real delays. */
  now?: () => number;
  /** Injectable delay function, defaults to a real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Runs a pollable asyncLifecycle action to completion within a bounded wait
 * budget, falling back to a "pending" handle for callers to poll manually
 * when the budget runs out. Safe to use on both long-lived Node/Docker
 * runtimes and Cloudflare Workers, which cap how long a single request may
 * stay open.
 */
export class AwaitActionRunner {
  private readonly catalog: CatalogStore;
  private readonly actions: ActionRunner;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: AwaitActionRunnerOptions) {
    this.catalog = options.catalog;
    this.actions = options.actions;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async run(input: AwaitActionInput): Promise<AwaitActionResult | undefined> {
    const action = this.catalog.actionsById.get(input.actionId);
    if (!action) {
      return undefined;
    }
    if (!isPollableAsyncLifecycle(action.asyncLifecycle)) {
      return { kind: "not_pollable" };
    }
    const lifecycle = action.asyncLifecycle;

    const start = await this.actions.run({
      actionId: input.actionId,
      input: input.input,
      caller: input.caller,
      connectionName: input.connectionName,
    });
    if (!start) {
      return undefined;
    }
    if (!start.result.ok) {
      return { kind: "settled", executionId: start.executionId, result: start.result };
    }

    const jobId = readPath(start.result.output, lifecycle.jobIdOutputPath);
    if (typeof jobId !== "string" && typeof jobId !== "number") {
      return {
        kind: "settled",
        executionId: start.executionId,
        result: {
          ok: false,
          error: {
            code: "job_id_extraction_failed",
            message: `Could not read a job id at "${lifecycle.jobIdOutputPath}" from the start action output.`,
          },
        },
      };
    }

    return this.poll(action.service, lifecycle, String(jobId), start.executionId, input);
  }

  private async poll(
    service: string,
    lifecycle: PollableAsyncLifecycle,
    jobId: string,
    startExecutionId: string,
    input: AwaitActionInput,
  ): Promise<AwaitActionResult | undefined> {
    const maxWaitMs = clampMaxWaitMs(input.maxWaitMs);
    const deadline = this.now() + maxWaitMs;
    let delayMs = initialPollDelayMs;

    while (this.now() < deadline) {
      if (input.signal?.aborted) {
        if (lifecycle.cancelActionId) {
          await this.actions.run({
            actionId: lifecycle.cancelActionId,
            input: { [lifecycle.jobIdInputField]: jobId },
            caller: input.caller,
            connectionName: input.connectionName,
          });
        }
        return {
          kind: "settled",
          executionId: startExecutionId,
          result: { ok: false, error: { code: "aborted", message: "The await request was aborted." } },
        };
      }

      await this.sleep(Math.min(delayMs, Math.max(deadline - this.now(), 0)));
      const status = await this.actions.run({
        actionId: lifecycle.statusActionId,
        input: { [lifecycle.jobIdInputField]: jobId },
        caller: input.caller,
        connectionName: input.connectionName,
      });
      if (!status) {
        return undefined;
      }
      if (!status.result.ok) {
        return { kind: "settled", executionId: status.executionId, result: status.result };
      }

      const completion = readPath(status.result.output, lifecycle.completionPath);
      if (lifecycle.completionValues.done.includes(completion)) {
        return { kind: "settled", executionId: status.executionId, result: status.result };
      }
      if (lifecycle.completionValues.failed?.includes(completion)) {
        return {
          kind: "settled",
          executionId: status.executionId,
          result: {
            ok: false,
            error: {
              code: "async_action_failed",
              message: `${service} reported a terminal failure status: ${String(completion)}.`,
              details: status.result.output,
            },
          },
        };
      }

      delayMs = Math.min(delayMs * pollBackoffMultiplier, maxPollDelayMs);
    }

    return { kind: "pending", executionId: startExecutionId, jobId, statusActionId: lifecycle.statusActionId };
  }
}

function clampMaxWaitMs(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return defaultMaxWaitMs;
  }
  return Math.min(Math.max(requested, minWaitMs), maxWaitMsCap);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
