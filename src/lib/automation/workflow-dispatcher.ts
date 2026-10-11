import { prisma } from "@/lib/db/client";
import { executeRun, type ExecuteRunResult } from "@/lib/workflow/runner";
import { RUN_STATUS, RUN_TERMINAL_STATUSES } from "@/lib/workflow/types";
import {
  claimWorkflowRun,
  getWorkerId,
  MAX_EVENT_ATTEMPTS,
  releaseWorkflowRun,
} from "./claim";
import { createDbStepApi, WorkflowRunYield } from "./step-api";

const MAX_RUN_RETRIES = 3;

async function clearLeaseOnTerminal(runId: string): Promise<void> {
  await prisma.workflowRun.updateMany({
    where: { id: runId },
    data: { executionOwner: null, executionLeaseUntil: null },
  });
}

/**
 * Execute a workflow run under atomic lease claim.
 * Returns skipped when another worker owns the run.
 */
export async function processWorkflowRunWithClaim(
  runId: string,
  workerId = getWorkerId(),
): Promise<ExecuteRunResult & { skipped?: boolean }> {
  const claimed = await claimWorkflowRun(runId, workerId);
  if (!claimed) return { status: RUN_STATUS.RUNNING, stepsExecuted: 0, skipped: true };

  try {
    const run = await prisma.workflowRun.findUnique({
      where: { id: runId },
      select: { status: true, nextRunAt: true },
    });
    if (!run) return { status: "MISSING", stepsExecuted: 0 };
    if (run.status !== RUN_STATUS.RUNNING) {
      await clearLeaseOnTerminal(runId);
      return { status: run.status, stepsExecuted: 0 };
    }
    if (run.nextRunAt && run.nextRunAt > new Date()) {
      await releaseWorkflowRun(runId, workerId);
      return { status: RUN_STATUS.RUNNING, stepsExecuted: 0 };
    }

    if (run.nextRunAt) {
      await prisma.workflowRun.update({
        where: { id: runId },
        data: { nextRunAt: null },
      });
    }

    const stepApi = createDbStepApi(runId);
    try {
      const result = await executeRun(runId, stepApi);
      if (RUN_TERMINAL_STATUSES.includes(result.status)) {
        await clearLeaseOnTerminal(runId);
      } else {
        await releaseWorkflowRun(runId, workerId);
      }
      return result;
    } catch (err) {
      if (err instanceof WorkflowRunYield) {
        await releaseWorkflowRun(runId, workerId);
        return { status: RUN_STATUS.RUNNING, stepsExecuted: 0 };
      }
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const current = await prisma.workflowRun.findUnique({
      where: { id: runId },
      select: { retryCount: true },
    });
    const retryCount = (current?.retryCount ?? 0) + 1;
    if (retryCount >= MAX_RUN_RETRIES) {
      await prisma.workflowRun.update({
        where: { id: runId },
        data: {
          status: RUN_STATUS.FAILED,
          error: message,
          retryCount,
          completedAt: new Date(),
          executionOwner: null,
          executionLeaseUntil: null,
        },
      });
      return { status: RUN_STATUS.FAILED, stepsExecuted: 0 };
    }
    await prisma.workflowRun.update({
      where: { id: runId },
      data: {
        retryCount,
        error: message,
        nextRunAt: new Date(Date.now() + 30_000 * retryCount),
        executionOwner: null,
        executionLeaseUntil: null,
      },
    });
    return { status: RUN_STATUS.RUNNING, stepsExecuted: 0 };
  }
}

/** Schedule run for cron — no inline execution (webhook/cron safe). */
export function enqueueWorkflowRun(_runId: string): void {
  // Run stays RUNNING with nextRunAt null — cron claims due runs.
}

/** Cloud Scheduler: claim + process due workflow runs. */
export async function reconcileDueWorkflowRuns(limit = 50): Promise<{
  claimed: number;
  processed: number;
  skipped: number;
  failed: number;
}> {
  const now = new Date();
  const due = await prisma.workflowRun.findMany({
    where: {
      status: RUN_STATUS.RUNNING,
      AND: [
        { OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
        { OR: [{ executionLeaseUntil: null }, { executionLeaseUntil: { lte: now } }] },
      ],
    },
    orderBy: [{ nextRunAt: "asc" }, { startedAt: "asc" }],
    take: limit,
    select: { id: true },
  });

  let claimed = 0;
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of due) {
    const result = await processWorkflowRunWithClaim(row.id);
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    claimed += 1;
    processed += 1;
    if (result.status === RUN_STATUS.FAILED) failed += 1;
  }

  return { claimed, processed, skipped, failed };
}

/** Claim + process pending internal events. */
export async function reconcileUnprocessedEvents(limit = 50): Promise<{
  processed: number;
  skipped: number;
  failed: number;
}> {
  const { dispatchEventRecord } = await import("@/lib/events/dispatch");
  const now = new Date();
  const pending = await prisma.internalEvent.findMany({
    where: {
      processedAt: null,
      failedAt: null,
      attemptCount: { lt: MAX_EVENT_ATTEMPTS },
      AND: [
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { OR: [{ processingLeaseUntil: null }, { processingLeaseUntil: { lte: now } }] },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of pending) {
    const outcome = await dispatchEventRecord(row);
    if (outcome === "processed") processed += 1;
    else if (outcome === "skipped") skipped += 1;
    else failed += 1;
  }
  return { processed, skipped, failed };
}
