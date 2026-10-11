import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { RUN_STATUS } from "@/lib/workflow/types";

export const WORKFLOW_LEASE_MS = 120_000;
export const EVENT_LEASE_MS = 60_000;
export const MAX_EVENT_ATTEMPTS = 5;

let cachedWorkerId: string | null = null;

/** Stable per Cloud Run instance / local process. */
export function getWorkerId(): string {
  if (cachedWorkerId) return cachedWorkerId;
  const revision = process.env.K_REVISION ?? "local";
  const service = process.env.K_SERVICE ?? "airborne-admin";
  cachedWorkerId = `${service}:${revision}:${randomUUID().slice(0, 8)}`;
  return cachedWorkerId;
}

function leaseUntil(ms: number): Date {
  return new Date(Date.now() + ms);
}

/** Atomic claim — only one worker executes a RUNNING due run. */
export async function claimWorkflowRun(runId: string, workerId: string): Promise<boolean> {
  const now = new Date();
  const updated = await prisma.workflowRun.updateMany({
    where: {
      id: runId,
      status: RUN_STATUS.RUNNING,
      AND: [
        { OR: [{ executionLeaseUntil: null }, { executionLeaseUntil: { lte: now } }] },
        { OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
      ],
    },
    data: {
      executionOwner: workerId,
      executionLeaseUntil: leaseUntil(WORKFLOW_LEASE_MS),
    },
  });
  return updated.count === 1;
}

export async function releaseWorkflowRun(runId: string, workerId: string): Promise<void> {
  await prisma.workflowRun.updateMany({
    where: { id: runId, executionOwner: workerId },
    data: { executionOwner: null, executionLeaseUntil: null },
  });
}

export async function renewWorkflowLease(runId: string, workerId: string): Promise<void> {
  await prisma.workflowRun.updateMany({
    where: { id: runId, executionOwner: workerId, status: RUN_STATUS.RUNNING },
    data: { executionLeaseUntil: leaseUntil(WORKFLOW_LEASE_MS) },
  });
}

/** Atomic claim for internal event processing. */
export async function claimInternalEvent(eventId: string, workerId: string): Promise<boolean> {
  const now = new Date();
  const updated = await prisma.internalEvent.updateMany({
    where: {
      id: eventId,
      processedAt: null,
      failedAt: null,
      attemptCount: { lt: MAX_EVENT_ATTEMPTS },
      AND: [
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { OR: [{ processingLeaseUntil: null }, { processingLeaseUntil: { lte: now } }] },
      ],
    },
    data: {
      processingOwner: workerId,
      processingLeaseUntil: leaseUntil(EVENT_LEASE_MS),
    },
  });
  return updated.count === 1;
}

export async function releaseInternalEvent(eventId: string, workerId: string): Promise<void> {
  await prisma.internalEvent.updateMany({
    where: { id: eventId, processingOwner: workerId },
    data: { processingOwner: null, processingLeaseUntil: null },
  });
}
