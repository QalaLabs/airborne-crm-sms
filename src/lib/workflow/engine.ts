import { prisma } from "@/lib/db/client";
import type { Prisma, WorkflowTrigger } from "@prisma/client";
import { validUuid } from "@/lib/events/actor";
import { enqueueWorkflowRun } from "@/lib/automation/workflow-dispatcher";
import { EVENT_TRIGGER_MAP, normalizeEventName } from "@/lib/events/catalog";
import { evaluateCondition, isConditionSpec } from "./conditions";
import { loadEntitySnapshot, resolveEntityFromEvent } from "./snapshots";

// ─── Event → workflow matcher ────────────────────────────────────────────────
//
// Called by the Inngest fan-out function for every triggerable business event.
// Finds active workflows whose trigger matches the canonical event, evaluates
// their triggerConditions against a fresh entity snapshot, and creates exactly
// one deduped WorkflowRun per matching workflow.

export interface MatchResult {
  created: number;
  duplicates: number;
  runIds: string[];
}

export async function matchAndStartRuns(input: {
  orgId: string;
  rawEventName: string;
  actorId?: string;
  actorName?: string;
  requestId?: string;
  data: Record<string, unknown>;
}): Promise<MatchResult> {
  const canonical = normalizeEventName(input.rawEventName);
  if (!canonical) return { created: 0, duplicates: 0, runIds: [] };

  const trigger: WorkflowTrigger | undefined = EVENT_TRIGGER_MAP[canonical];
  if (!trigger) return { created: 0, duplicates: 0, runIds: [] };

  const entity = resolveEntityFromEvent(canonical, input.data);
  if (!entity) return { created: 0, duplicates: 0, runIds: [] };

  // Only workflows that are active AND configured for this trigger. Condition
  // evaluation needs a snapshot, so fetch candidates first, snapshot once.
  const candidates = await prisma.workflow.findMany({
    where: { orgId: input.orgId, isActive: true, triggerEvent: trigger },
    select: { id: true, code: true, name: true, triggerConditions: true },
    orderBy: { createdAt: "asc" },
  });
  if (candidates.length === 0) return { created: 0, duplicates: 0, runIds: [] };

  const snapshot = await loadEntitySnapshot(input.orgId, entity.entityType, entity.entityId);
  if (!snapshot) return { created: 0, duplicates: 0, runIds: [] };

  const evaluationCtx = { ...snapshot, event: input.data };
  const dedupKey = buildDedupKey(input.rawEventName, entity.entityId, input.requestId);

  const result: MatchResult = { created: 0, duplicates: 0, runIds: [] };

  for (const workflow of candidates) {
    const conditions = workflow.triggerConditions as unknown;
    if (!conditionsMatch(conditions, evaluationCtx)) {
      if (!isEmptyConditions(conditions) && !isConditionSpec(conditions)) {
        console.warn("[workflow] skipped: invalid triggerConditions", workflow.id, workflow.code);
      }
      continue;
    }

    try {
      const run = await prisma.workflowRun.create({
        data: {
          orgId: input.orgId,
          workflowId: workflow.id,
          entityType: entity.entityType,
          entityId: entity.entityId,
          triggeredBy: validUuid(input.actorId),
          status: "RUNNING",
          dedupKey,
          context: {
            eventName: canonical,
            event: input.data,
          } as Prisma.InputJsonValue,
        },
      });
      result.created += 1;
      result.runIds.push(run.id);

      enqueueWorkflowRun(run.id);
    } catch (err) {
      // P2002 unique-violation on dedupKey → this exact event already started
      // this workflow for this entity. That is success from the engine's point
      // of view; anything else is rethrown so Inngest retries the matcher.
      if (isUniqueViolation(err)) {
        result.duplicates += 1;
        continue;
      }
      throw err;
    }
  }

  return result;
}

function buildDedupKey(eventName: string, entityId: string, requestId?: string): string {
  return `${eventName}:${entityId}:${requestId ?? "no-request"}`;
}

function isUniqueViolation(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/** Workflow.triggerConditions uses the same ConditionSpec grammar as steps. */
function isEmptyConditions(conditions: unknown): boolean {
  return !conditions || (typeof conditions === "object" && Object.keys(conditions as object).length === 0);
}

export function conditionsMatch(conditions: unknown, ctx: Record<string, unknown>): boolean {
  if (isEmptyConditions(conditions)) return true; // empty conditions = always match
  return evaluateCondition(conditions as Parameters<typeof evaluateCondition>[0], ctx);
}
