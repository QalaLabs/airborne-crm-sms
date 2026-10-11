import { WorkflowRunYield } from "@/lib/automation/step-api";
import { prisma } from "@/lib/db/client";
import { validUuid } from "@/lib/events/actor";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { evaluateCondition } from "./conditions";
import { executeAction, stopAllRunsForEntity } from "./actions";
import { loadEntitySnapshot } from "./snapshots";
import {
  RUN_STATUS,
  RUN_TERMINAL_STATUSES,
  type ActionContext,
  type WorkflowStep,
} from "./types";

// ─── Durable run executor ─────────────────────────────────────────────────────
//
// Executes one WorkflowRun step-by-step inside an Inngest function. Durability
// comes from three mechanisms:
//
// 1. step.run memoization — every side effect and cursor advance is a named,
//    idempotent Inngest step; retries skip completed work.
// 2. Persisted cursor — WorkflowRun.currentStep is advanced only after a step
//    fully succeeds, so a crash resumes at the exact step.
// 3. Chunked waits — WAIT sleeps in WAIT_CHUNK_MS slices, re-reading the run
//    status from the DB between slices, so PAUSED / CANCELLED / STOPPED (opt-
//    out, reply-pause) take effect mid-wait without losing position.

interface RunWithWorkflow {
  id: string;
  orgId: string;
  workflowId: string;
  entityType: string;
  entityId: string;
  triggeredBy: string | null;
  currentStep: number;
  status: string;
  context: unknown;
  steps: WorkflowStep[];
}

async function loadRun(runId: string): Promise<RunWithWorkflow | null> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      orgId: true,
      workflowId: true,
      entityType: true,
      entityId: true,
      triggeredBy: true,
      currentStep: true,
      status: true,
      context: true,
      workflow: { select: { id: true, isActive: true, name: true, steps: true } },
    },
  });
  if (!run) return null;
  return {
    id: run.id,
    orgId: run.orgId,
    workflowId: run.workflowId,
    entityType: run.entityType,
    entityId: run.entityId,
    triggeredBy: run.triggeredBy,
    currentStep: run.currentStep,
    status: run.status,
    context: run.context,
    steps: Array.isArray(run.workflow.steps) ? (run.workflow.steps as unknown as WorkflowStep[]) : [],
  };
}

async function reloadStatus(runId: string): Promise<string | null> {
  const row = await prisma.workflowRun.findUnique({ where: { id: runId }, select: { status: true } });
  return row?.status ?? null;
}

async function markStatus(
  runId: string,
  status: string,
  extra?: { error?: string; stoppedReason?: string; advanceTo?: number },
): Promise<void> {
  const now = new Date();
  await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status,
      ...(extra?.error !== undefined && { error: extra.error }),
      ...(extra?.stoppedReason !== undefined && { stoppedReason: extra.stoppedReason }),
      ...(extra?.advanceTo !== undefined && { currentStep: extra.advanceTo }),
      ...(status === RUN_STATUS.PAUSED && { pausedAt: now }),
      ...(status === RUN_STATUS.STOPPED && { stoppedAt: now }),
      ...(status !== RUN_STATUS.RUNNING && status !== RUN_STATUS.PAUSED && { completedAt: now }),
      ...(RUN_TERMINAL_STATUSES.includes(status) && {
        executionOwner: null,
        executionLeaseUntil: null,
      }),
    },
  });
}

function waitMs(duration: { days?: number; hours?: number; minutes?: number }): number {
  return (
    (duration.days ?? 0) * 86_400_000 + (duration.hours ?? 0) * 3_600_000 + (duration.minutes ?? 0) * 60_000
  );
}

export interface ExecuteRunResult {
  status: string;
  stepsExecuted: number;
}

/**
 * Execute (or continue) a workflow run. Safe to invoke repeatedly — a finished
 * or paused run returns immediately with its current status.
 */
export async function executeRun(runId: string, stepApi: InngestStepApi): Promise<ExecuteRunResult> {
  const run = await loadRun(runId);
  if (!run) return { status: "MISSING", stepsExecuted: 0 };
  if (run.status !== RUN_STATUS.RUNNING) return { status: run.status, stepsExecuted: 0 };

  const actorId = validUuid(run.triggeredBy) ?? undefined;
  const eventPayload =
    run.context && typeof run.context === "object" && "event" in (run.context as Record<string, unknown>)
      ? ((run.context as Record<string, unknown>).event as Record<string, unknown>)
      : {};

  const baseCtx: Omit<ActionContext, "idempotencyKey"> = {
    orgId: run.orgId,
    runId: run.id,
    workflowId: run.workflowId,
    entityType: run.entityType,
    entityId: run.entityId,
    actorId,
    requestId: `run-${run.id}`,
    event: eventPayload,
  };

  let executed = 0;
  let cursor = run.currentStep;

  // Mutable working copy — CONDITION splices its branch steps in place.
  const queue: WorkflowStep[] = [...run.steps];

  while (true) {
    const status = await reloadStatus(run.id);
    if (!status || status !== RUN_STATUS.RUNNING) {
      return { status: status ?? "MISSING", stepsExecuted: executed };
    }

    if (cursor >= queue.length) break;
    const step = queue[cursor];
    if (!step || typeof step.type !== "string") {
      // Malformed step config — fail the run loudly rather than loop forever.
      await stepApi.run(`fail-${cursor}`, async () => {
        await markStatus(run.id, RUN_STATUS.FAILED, { error: `Malformed step at index ${cursor}` });
      });
      return { status: RUN_STATUS.FAILED, stepsExecuted: executed };
    }

    // ── WAIT ─────────────────────────────────────────────────────────────────
    if (step.type === "WAIT") {
      const row = await prisma.workflowRun.findUnique({
        where: { id: run.id },
        select: { nextRunAt: true },
      });
      const now = new Date();
      if (row?.nextRunAt && row.nextRunAt > now) {
        throw new WorkflowRunYield();
      }
      const ms = waitMs(step.duration);
      if (!row?.nextRunAt) {
        await prisma.workflowRun.update({
          where: { id: run.id },
          data: { nextRunAt: new Date(now.getTime() + ms) },
        });
        throw new WorkflowRunYield();
      }
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: { nextRunAt: null },
      });
      await markStatus(run.id, RUN_STATUS.RUNNING, { advanceTo: cursor + 1 });
      cursor += 1;
      continue;
    }

    // ── CONDITION ────────────────────────────────────────────────────────────
    if (step.type === "CONDITION") {
      const snapshot = await loadEntitySnapshot(run.orgId, run.entityType, run.entityId);
      const matched = evaluateCondition(step.condition, { ...(snapshot ?? {}), event: eventPayload });
      const branch = matched ? step.then : (step.else ?? []);
      queue.splice(cursor + 1, 0, ...branch);
      await stepApi.run(`advance-${cursor}`, async () => {
        await markStatus(run.id, RUN_STATUS.RUNNING, { advanceTo: cursor + 1 });
      });
      cursor += 1;
      continue;
    }

    // ── STOP_WORKFLOW ────────────────────────────────────────────────────────
    if (step.type === "STOP_WORKFLOW") {
      const reason = step.reason ?? "Stopped by workflow step";
      await stepApi.run(`stop-${cursor}`, async () => {
        if (step.stopAllForEntity) {
          await stopAllRunsForEntity(run.orgId, run.entityType, run.entityId, reason, run.id);
        }
        await markStatus(run.id, RUN_STATUS.STOPPED, { stoppedReason: reason });
        await AuditService.write({
          orgId: run.orgId,
          userId: validUuid(actorId),
          action: "workflow.run_stopped",
          entityType: "workflow_run",
          entityId: run.id,
          newValue: { reason, workflowId: run.workflowId },
        });
        await ActivityFeedService.write({
          orgId: run.orgId,
          actorId: validUuid(actorId),
          verb: "automation_stopped",
          objectType: "workflow_run",
          objectId: run.id,
          objectSnapshot: { entityType: run.entityType, entityId: run.entityId },
          targetType: "workflow",
          targetId: run.workflowId,
          context: { reason },
        });
      });
      return { status: RUN_STATUS.STOPPED, stepsExecuted: executed };
    }

    // ── Regular action ───────────────────────────────────────────────────────
    const result = (await stepApi.run(`action-${cursor}`, async () => {
      const snapshot = await loadEntitySnapshot(run.orgId, run.entityType, run.entityId);
      if (!snapshot) {
        return { ok: true, skipped: true, detail: "Entity not found" } as const;
      }
      const ctx: ActionContext = { ...baseCtx, idempotencyKey: `${run.id}:${cursor}` };
      const actionResult = await executeAction(step, ctx, snapshot);
      await markStatus(run.id, RUN_STATUS.RUNNING, { advanceTo: cursor + 1 });
      return actionResult;
    })) as { ok: boolean; skipped?: boolean; detail?: string };

    executed += 1;
    cursor += 1;

    if (!result.ok) {
      await stepApi.run(`fail-after-${cursor - 1}`, async () => {
        await markStatus(run.id, RUN_STATUS.FAILED, {
          error: `Step ${cursor - 1} (${step.type}) failed: ${result.detail ?? "unknown"}`,
        });
        await ActivityFeedService.write({
          orgId: run.orgId,
          actorId: validUuid(actorId),
          verb: "automation_failed",
          objectType: "workflow_run",
          objectId: run.id,
          objectSnapshot: { entityType: run.entityType, entityId: run.entityId, step: step.type },
          targetType: "workflow",
          targetId: run.workflowId,
          context: { detail: result.detail },
        });
      });
      return { status: RUN_STATUS.FAILED, stepsExecuted: executed };
    }
  }

  await stepApi.run("complete", async () => {
    const live = await reloadStatus(run.id);
    if (live !== RUN_STATUS.RUNNING) return;
    await markStatus(run.id, RUN_STATUS.COMPLETED);
    await ActivityFeedService.write({
      orgId: run.orgId,
      actorId: validUuid(actorId),
      verb: "automation_completed",
      objectType: "workflow_run",
      objectId: run.id,
      objectSnapshot: { entityType: run.entityType, entityId: run.entityId },
      targetType: "workflow",
      targetId: run.workflowId,
      context: {},
    });
  });

  return { status: RUN_STATUS.COMPLETED, stepsExecuted: executed };
}

// Minimal structural type for the subset of Inngest step tools the runner uses.
// Kept local so the runner stays unit-testable without importing inngest; the
// real SDK step object satisfies this shape (run results are JSON-serialized).
export interface InngestStepApi {
  run(id: string, fn: () => Promise<unknown>): Promise<unknown>;
  sleep(id: string, ms: number): Promise<void>;
}
