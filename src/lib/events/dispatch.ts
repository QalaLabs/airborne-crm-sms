import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import {
  claimInternalEvent,
  getWorkerId,
  MAX_EVENT_ATTEMPTS,
  releaseInternalEvent,
} from "@/lib/automation/claim";
import { runEventSideEffects } from "@/lib/automation/event-handlers";
import { syncInteraktTrack } from "@/lib/automation/interakt-track.service";
import { processWorkflowRunWithClaim } from "@/lib/automation/workflow-dispatcher";
import { getProvider } from "@/lib/messaging";
import { InteraktProvider } from "@/lib/messaging/providers/interakt.provider";
import { isLeadCreatedEventName } from "@/lib/messaging/providers/interakt/mapping";
import { matchAndStartRuns } from "@/lib/workflow/engine";
import type { AppEvent } from "@/types";

const EVENT_BACKOFF_MS = 30_000;

function requestIdFor(event: AppEvent): string {
  return event.requestId?.trim() || `${event.name}:${Date.now()}`;
}

/** Persist only — safe inside webhook before HTTP 200. */
export async function persistInternalEvent(
  event: AppEvent,
): Promise<{ id: string | null; duplicate: boolean }> {
  const requestId = requestIdFor(event);
  try {
    const row = await prisma.internalEvent.create({
      data: {
        orgId: event.orgId,
        name: event.name,
        requestId,
        actorId: event.actorId ?? null,
        actorName: event.actorName ?? null,
        payload: {
          ...event.data,
          actorId: event.actorId,
          actorName: event.actorName,
          ipAddress: event.ipAddress,
          timestamp: event.timestamp,
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { id: row.id, duplicate: false };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "P2002") return { id: null, duplicate: true };
    throw err;
  }
}

/** Process one persisted event under atomic claim. */
export async function dispatchEventRecord(row: {
  id: string;
  orgId: string;
  name: string;
  requestId: string;
  actorId: string | null;
  actorName: string | null;
  payload: unknown;
}): Promise<"processed" | "skipped" | "failed"> {
  const workerId = getWorkerId();
  const claimed = await claimInternalEvent(row.id, workerId);
  if (!claimed) return "skipped";

  try {
    const payload =
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};

    const event = {
      orgId: row.orgId,
      name: row.name,
      actorId: row.actorId ?? "system",
      actorName: row.actorName ?? "Automation Engine",
      requestId: row.requestId,
      timestamp: typeof payload.timestamp === "string" ? payload.timestamp : new Date().toISOString(),
      data: payload,
    } as AppEvent;

    await syncInteraktTrack(event);
    await runEventSideEffects(event);

    // Interakt Advanced owns lead-created WhatsApp delays/templates.
    // Do not start Airborne SEND_WHATSAPP nurture when Interakt is live.
    if (!shouldSkipAirborneLeadNurture(event.name)) {
      const match = await matchAndStartRuns({
        orgId: event.orgId,
        rawEventName: event.name,
        actorId: event.actorId,
        actorName: event.actorName,
        requestId: event.requestId,
        data: payload,
      });

      for (const runId of match.runIds) {
        await processWorkflowRunWithClaim(runId);
      }
    }

    await prisma.internalEvent.update({
      where: { id: row.id },
      data: {
        processedAt: new Date(),
        lastError: null,
        processingOwner: null,
        processingLeaseUntil: null,
      },
    });
    return "processed";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const current = await prisma.internalEvent.findUnique({
      where: { id: row.id },
      select: { attemptCount: true },
    });
    const attemptCount = (current?.attemptCount ?? 0) + 1;
    const permanent = attemptCount >= MAX_EVENT_ATTEMPTS;

    await prisma.internalEvent.update({
      where: { id: row.id },
      data: {
        attemptCount,
        lastError: message.slice(0, 2000),
        nextAttemptAt: permanent ? null : new Date(Date.now() + EVENT_BACKOFF_MS * attemptCount),
        failedAt: permanent ? new Date() : null,
        processingOwner: null,
        processingLeaseUntil: null,
      },
    });
    console.error("[Dispatch] event processing failed", row.name, row.id, message);
    return "failed";
  } finally {
    await releaseInternalEvent(row.id, workerId);
  }
}

/**
 * Persist + process inline — caller HTTP request still alive (API paths).
 * Webhooks must use persistEventForWebhook() instead.
 */
export async function dispatchEvent(event: AppEvent): Promise<void> {
  try {
    const persisted = await persistInternalEvent(event);
    const row = persisted.id
      ? await prisma.internalEvent.findUnique({ where: { id: persisted.id } })
      : persisted.duplicate
        ? await prisma.internalEvent.findUnique({
            where: {
              orgId_name_requestId: {
                orgId: event.orgId,
                name: event.name,
                requestId: requestIdFor(event),
              },
            },
          })
        : null;
    if (!row || row.processedAt) return;

    await dispatchEventRecord(row);
  } catch (err) {
    console.error("[Dispatch] event failed", event.name, err);
  }
}

function shouldSkipAirborneLeadNurture(eventName: string): boolean {
  if (!isLeadCreatedEventName(eventName)) return false;
  const provider = getProvider("WHATSAPP");
  return provider instanceof InteraktProvider && provider.isConfigured();
}

/**
 * Webhook-safe: persist row only. Cron / inline API dispatcher processes later.
 * No fire-and-forget processing — survives Cloud Run request teardown.
 */
export async function persistEventForWebhook(event: AppEvent): Promise<void> {
  try {
    await persistInternalEvent(event);
  } catch (err) {
    console.error("[Dispatch] webhook persist failed", event.name, err);
  }
}

/** @deprecated Use persistEventForWebhook — kept for call-site compatibility. */
export function dispatchEventAsync(event: AppEvent): void {
  void persistEventForWebhook(event);
}

export function isAutomationEngineEnabled(): boolean {
  return true;
}

/** Back-compat alias. */
export async function emitEvent(event: AppEvent): Promise<void> {
  await dispatchEvent(event);
}

export function isInngestEnabled(): boolean {
  return false;
}
