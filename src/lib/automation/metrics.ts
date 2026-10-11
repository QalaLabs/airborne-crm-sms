import { prisma } from "@/lib/db/client";
import { RUN_STATUS } from "@/lib/workflow/types";
import { MAX_EVENT_ATTEMPTS } from "./claim";

export interface AutomationMetricsSnapshot {
  ts: string;
  workflows: {
    running: number;
    paused: number;
    failed: number;
    completed: number;
    stopped: number;
    leased: number;
    dueNow: number;
  };
  events: {
    pending: number;
    failed: number;
    retryScheduled: number;
  };
  whatsapp: {
    failedOutbound24h: number;
  };
  lastExecutionAt: string | null;
}

export async function collectAutomationMetrics(): Promise<AutomationMetricsSnapshot> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const [running, paused, failed, completed, stopped, leased, dueNow, pendingEvents, failedEvents, retryEvents, failedWa, lastRun] =
    await Promise.all([
      prisma.workflowRun.count({ where: { status: RUN_STATUS.RUNNING } }),
      prisma.workflowRun.count({ where: { status: RUN_STATUS.PAUSED } }),
      prisma.workflowRun.count({ where: { status: RUN_STATUS.FAILED } }),
      prisma.workflowRun.count({ where: { status: RUN_STATUS.COMPLETED } }),
      prisma.workflowRun.count({ where: { status: RUN_STATUS.STOPPED } }),
      prisma.workflowRun.count({
        where: { status: RUN_STATUS.RUNNING, executionLeaseUntil: { gt: now } },
      }),
      prisma.workflowRun.count({
        where: {
          status: RUN_STATUS.RUNNING,
          AND: [
            { OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
            { OR: [{ executionLeaseUntil: null }, { executionLeaseUntil: { lte: now } }] },
          ],
        },
      }),
      prisma.internalEvent.count({
        where: { processedAt: null, failedAt: null, attemptCount: { lt: MAX_EVENT_ATTEMPTS } },
      }),
      prisma.internalEvent.count({ where: { failedAt: { not: null } } }),
      prisma.internalEvent.count({
        where: { processedAt: null, failedAt: null, nextAttemptAt: { gt: now } },
      }),
      prisma.whatsAppMessage.count({
        where: { direction: "OUT", status: "FAILED", createdAt: { gte: dayAgo } },
      }),
      prisma.workflowRun.findFirst({
        where: { completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true },
      }),
    ]);

  const snapshot: AutomationMetricsSnapshot = {
    ts: now.toISOString(),
    workflows: { running, paused, failed, completed, stopped, leased, dueNow },
    events: { pending: pendingEvents, failed: failedEvents, retryScheduled: retryEvents },
    whatsapp: { failedOutbound24h: failedWa },
    lastExecutionAt: lastRun?.completedAt?.toISOString() ?? null,
  };

  console.info("[AutomationMetrics]", JSON.stringify(snapshot));
  return snapshot;
}
