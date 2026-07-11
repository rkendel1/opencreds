import type { ActionDefinition } from "./types.ts";

import { describe, expect, it } from "vitest";
import { isPollableAsyncLifecycle } from "./async-lifecycle.ts";

describe("isPollableAsyncLifecycle", () => {
  it("returns false when asyncLifecycle is absent", () => {
    expect(isPollableAsyncLifecycle(undefined)).toBe(false);
  });

  it("returns false when only the start/status/cancel ids are declared", () => {
    const lifecycle: ActionDefinition["asyncLifecycle"] = {
      startActionId: "svc.start",
      statusActionId: "svc.status",
    };
    expect(isPollableAsyncLifecycle(lifecycle)).toBe(false);
  });

  it("returns false when completionValues.done is empty", () => {
    const lifecycle: ActionDefinition["asyncLifecycle"] = {
      startActionId: "svc.start",
      statusActionId: "svc.status",
      jobIdOutputPath: "id",
      jobIdInputField: "id",
      completionPath: "status",
      completionValues: { done: [] },
    };
    expect(isPollableAsyncLifecycle(lifecycle)).toBe(false);
  });

  it("returns true when all mapping fields are present", () => {
    const lifecycle: ActionDefinition["asyncLifecycle"] = {
      startActionId: "svc.start",
      statusActionId: "svc.status",
      jobIdOutputPath: "test.id",
      jobIdInputField: "test_id",
      completionPath: "is_complete",
      completionValues: { done: [true] },
    };
    expect(isPollableAsyncLifecycle(lifecycle)).toBe(true);
  });
});
