import { persistInternalEvent, dispatchEventRecord } from "@/lib/events/dispatch";
import { prisma } from "@/lib/db/client";
import type { AppEvent } from "@/types";

export function leadCreatedRequestId(leadId: string): string {
  return `lead:${leadId}`;
}

export interface EmitLeadCreatedInput {
  orgId: string;
  leadId: string;
  leadName: string;
  source: string;
  courseInterest?: string | null;
  actorId?: string;
  actorName?: string;
  ipAddress?: string;
}

/**
 * Persist `lead/created` then process inline. Idempotent on lead id so
 * website/Google/admin retries cannot fire Interakt `lead_created` twice.
 */
export async function emitLeadCreated(input: EmitLeadCreatedInput): Promise<void> {
  const requestId = leadCreatedRequestId(input.leadId);
  const event = {
    name: "lead/created",
    orgId: input.orgId,
    actorId: input.actorId ?? "system",
    actorName: input.actorName ?? "Lead intake",
    requestId,
    ipAddress: input.ipAddress,
    timestamp: new Date().toISOString(),
    data: {
      leadId: input.leadId,
      leadName: input.leadName,
      source: input.source,
      courseInterest: input.courseInterest ?? undefined,
    },
  } as AppEvent;

  try {
    const persisted = await persistInternalEvent(event);
    const row = persisted.id
      ? await prisma.internalEvent.findUnique({ where: { id: persisted.id } })
      : await prisma.internalEvent.findUnique({
          where: {
            orgId_name_requestId: {
              orgId: input.orgId,
              name: event.name,
              requestId,
            },
          },
        });

    if (!row || row.processedAt) return;

    if (row.failedAt) {
      await prisma.internalEvent.update({
        where: { id: row.id },
        data: {
          failedAt: null,
          nextAttemptAt: null,
          processingOwner: null,
          processingLeaseUntil: null,
        },
      });
    }

    await dispatchEventRecord(row);
  } catch (err) {
    console.error("[LeadCreated] emit failed", input.leadId, err);
  }
}
