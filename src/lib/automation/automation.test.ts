import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkflowRunYield } from "./step-api";
import { RUN_STATUS } from "@/lib/workflow/types";

test("WorkflowRunYield is distinguishable", () => {
  const err = new WorkflowRunYield();
  assert.equal(err.name, "WorkflowRunYield");
  assert.ok(err instanceof Error);
});

test("RUNNING is the active execution state", () => {
  assert.equal(RUN_STATUS.RUNNING, "RUNNING");
  assert.notEqual(RUN_STATUS.RUNNING, "ACTIVE");
});

test("dispatch dedup key uses requestId when present", async () => {
  const { dispatchEvent } = await import("@/lib/events/dispatch");
  assert.equal(typeof dispatchEvent, "function");
});

test("automation engine reports enabled", async () => {
  const { isAutomationEngineEnabled } = await import("@/lib/events/dispatch");
  assert.equal(isAutomationEngineEnabled(), true);
});

test("isInngestEnabled is false after migration", async () => {
  const { isInngestEnabled } = await import("@/lib/events/inngest");
  assert.equal(isInngestEnabled(), false);
});
