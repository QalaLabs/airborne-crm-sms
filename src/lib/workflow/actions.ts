import { LeadStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { validUuid } from "@/lib/events/actor";
import { processWorkflowRunWithClaim } from "@/lib/automation/workflow-dispatcher";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { NotificationService } from "@/lib/services/notification.service";
import { resolvePath } from "./conditions";
import type { ActionContext, ActionResult, WorkflowStep } from "./types";

// ─── Action executors ─────────────────────────────────────────────────────────
//
// Every action delegates to the existing service/repository layer — the engine
// never opens parallel write paths. System-context mutations write explicit
// audit + activity-feed rows (actor filtered through validUuid, mirroring
// src/lib/events/actor.ts conventions).

/** Resolve {{dotted.path}} tokens against the run's snapshot/event context. */
function interpolate(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path: string) => {
    const value = resolvePath(ctx, path);
    return value === undefined || value === null ? match : String(value);
  });
}

async function writeSystemAudit(
  ctx: ActionContext,
  action: string,
  entityId: string,
  newValue?: Record<string, unknown>,
): Promise<void> {
  await AuditService.write({
    orgId: ctx.orgId,
    userId: validUuid(ctx.actorId),
    requestId: ctx.requestId,
    action,
    entityType: "lead",
    entityId,
    newValue,
  });
}

async function writeLeadActivity(
  ctx: ActionContext,
  leadId: string,
  title: string,
  notes: string,
  dueAt?: Date,
): Promise<void> {
  await prisma.leadActivity.create({
    data: {
      leadId,
      orgId: ctx.orgId,
      performedBy: validUuid(ctx.actorId),
      activityType: "SYSTEM",
      title,
      notes,
      dueAt,
      completedAt: dueAt ? undefined : new Date(),
      metadata: { workflowRunId: ctx.runId, idempotencyKey: ctx.idempotencyKey },
    },
  });
}

export async function executeAction(
  step: WorkflowStep,
  ctx: ActionContext,
  snapshotCtx: Record<string, unknown>,
): Promise<ActionResult> {
  switch (step.type) {
    // ── Communications ──────────────────────────────────────────────────────
    case "SEND_WHATSAPP": {
      const recipient = resolvePath(snapshotCtx, "phone");
      if (typeof recipient !== "string" || !recipient) {
        return { ok: true, skipped: true, detail: "No phone on file" };
      }
      // Defense in depth: the opt-out kill-switch workflow stops runs on the
      // WHATSAPP_OPTED_OUT event, but long-running sequences re-check here so
      // an opt-out recorded mid-run is honored before every single send.
      // Non-lead entities (students) inherit the flag from their linked lead.
      let optOutFlag = resolvePath(snapshotCtx, "whatsappOptOut");
      if (optOutFlag === undefined) {
        const linkedLeadId = resolvePath(snapshotCtx, "leadId");
        if (typeof linkedLeadId === "string") {
          const linked = await prisma.lead.findFirst({
            where: { id: linkedLeadId, orgId: ctx.orgId },
            select: { whatsappOptOut: true },
          });
          optOutFlag = linked?.whatsappOptOut;
        }
      }
      if (optOutFlag === true) {
        return { ok: true, skipped: true, detail: "Contact opted out of WhatsApp" };
      }
      const variables = Object.fromEntries(
        Object.entries(step.variables ?? {}).map(([k, v]) => [k, interpolate(String(v), snapshotCtx)]),
      );
      // Routed through the existing notification pipeline. Until the WhatsApp
      // provider abstraction lands this honestly records NOT_CONFIGURED —
      // delivery is never faked.
      const leadIdRaw =
        ctx.entityType === "lead" ? ctx.entityId : resolvePath(snapshotCtx, "leadId");
      const leadId = typeof leadIdRaw === "string" ? leadIdRaw : undefined;
      const status = await NotificationService.dispatch({
        orgId: ctx.orgId,
        event: "WORKFLOW_TRIGGERED",
        channel: "WHATSAPP",
        recipient,
        variables: { ...variables, workflowRunId: ctx.runId },
        entityType: ctx.entityType.toLowerCase(),
        entityId: ctx.entityId,
        templateName: step.templateName,
        idempotencyKey: ctx.idempotencyKey,
        metadata: {
          ...(leadId ? { leadId } : {}),
          workflowRunId: ctx.runId,
          workflowStepKey: step.name ?? "SEND_WHATSAPP",
        },
      });
      return { ok: true, detail: `whatsapp:${status ?? "no-template"}` };
    }

    case "SEND_EMAIL": {
      const recipient = resolvePath(snapshotCtx, "email");
      if (typeof recipient !== "string" || !recipient) {
        return { ok: true, skipped: true, detail: "No email on file" };
      }
      const variables = Object.fromEntries(
        Object.entries(step.variables ?? {}).map(([k, v]) => [k, interpolate(String(v), snapshotCtx)]),
      );
      const status = await NotificationService.dispatch({
        orgId: ctx.orgId,
        event: step.event,
        channel: "EMAIL",
        recipient,
        variables,
        entityType: ctx.entityType.toLowerCase(),
        entityId: ctx.entityId,
      });
      return { ok: true, detail: `email:${status ?? "no-template"}` };
    }

    // ── Lead mutations (system context) ─────────────────────────────────────
    case "CREATE_TASK": {
      const leadId = resolvePath(snapshotCtx, "leadId") ?? resolvePath(snapshotCtx, "id");
      if (typeof leadId !== "string") {
        return { ok: true, skipped: true, detail: "Entity is not lead-linked" };
      }
      const dueAt = step.dueInDays
        ? new Date(Date.now() + step.dueInDays * 86_400_000)
        : step.dueInHours
          ? new Date(Date.now() + step.dueInHours * 3_600_000)
          : undefined;
      await prisma.leadActivity.create({
        data: {
          leadId,
          orgId: ctx.orgId,
          performedBy: validUuid(ctx.actorId),
          activityType: "TASK",
          title: interpolate(step.title, snapshotCtx),
          notes: step.notes ? interpolate(step.notes, snapshotCtx) : null,
          dueAt,
          metadata: { source: "workflow", workflowRunId: ctx.runId, idempotencyKey: ctx.idempotencyKey },
        },
      });
      return { ok: true };
    }

    case "ASSIGN_LEAD": {
      const leadId = resolvePath(snapshotCtx, "leadId") ?? resolvePath(snapshotCtx, "id");
      if (typeof leadId !== "string" || !step.counselorId) {
        return { ok: true, skipped: true, detail: "No lead or counselorId configured" };
      }
      const previous = resolvePath(snapshotCtx, "assignedTo");
      await prisma.lead.updateMany({
        where: { id: leadId, orgId: ctx.orgId },
        data: { assignedTo: step.counselorId },
      });
      await writeLeadActivity(
        ctx,
        leadId,
        "Assigned by automation",
        `Workflow assigned this lead to ${step.counselorId}`,
      );
      await writeSystemAudit(ctx, "workflow.lead_assigned", leadId, {
        from: previous ?? null,
        to: step.counselorId,
        runId: ctx.runId,
      });
      return { ok: true };
    }

    case "UPDATE_STATUS": {
      const leadId = resolvePath(snapshotCtx, "leadId") ?? resolvePath(snapshotCtx, "id");
      if (typeof leadId !== "string") {
        return { ok: true, skipped: true, detail: "Entity is not lead-linked" };
      }
      if (!Object.values(LeadStatus).includes(step.status as LeadStatus)) {
        throw new Error(`Invalid LeadStatus in workflow step: ${step.status}`);
      }
      const previous = resolvePath(snapshotCtx, "status");
      await prisma.lead.updateMany({ where: { id: leadId, orgId: ctx.orgId }, data: { status: step.status as LeadStatus } });
      await prisma.leadActivity.create({
        data: {
          leadId,
          orgId: ctx.orgId,
          performedBy: validUuid(ctx.actorId),
          activityType: "STATUS_CHANGE",
          title: `Status → ${step.status} (automation)`,
          notes: `Changed from ${String(previous)} to ${step.status} by workflow`,
          completedAt: new Date(),
          metadata: {
            oldStatus: previous === undefined ? null : previous,
            newStatus: step.status,
            workflowRunId: ctx.runId,
          } as Prisma.InputJsonValue,
        },
      });
      await writeSystemAudit(ctx, "workflow.lead_status_changed", leadId, {
        from: previous ?? null,
        to: step.status,
        runId: ctx.runId,
      });
      return { ok: true };
    }

    case "ADD_TAG":
    case "REMOVE_TAG": {
      const leadId = resolvePath(snapshotCtx, "leadId") ?? resolvePath(snapshotCtx, "id");
      if (typeof leadId !== "string") {
        return { ok: true, skipped: true, detail: "Entity is not lead-linked" };
      }
      const currentTags = Array.isArray(resolvePath(snapshotCtx, "tags"))
        ? ((resolvePath(snapshotCtx, "tags") as unknown[]).map(String))
        : [];
      const nextTags =
        step.type === "ADD_TAG"
          ? Array.from(new Set([...currentTags, step.tag]))
          : currentTags.filter((t) => t !== step.tag);
      if (nextTags.length === currentTags.length && step.type === "ADD_TAG") {
        return { ok: true, skipped: true, detail: "Tag already present" };
      }
      await prisma.lead.updateMany({ where: { id: leadId, orgId: ctx.orgId }, data: { tags: nextTags } });
      await writeSystemAudit(ctx, step.type === "ADD_TAG" ? "workflow.tag_added" : "workflow.tag_removed", leadId, {
        tag: step.tag,
        runId: ctx.runId,
      });
      return { ok: true };
    }

    case "UPDATE_LEAD": {
      const leadId = resolvePath(snapshotCtx, "leadId") ?? resolvePath(snapshotCtx, "id");
      if (typeof leadId !== "string") {
        return { ok: true, skipped: true, detail: "Entity is not lead-linked" };
      }
      const existingCustom = resolvePath(snapshotCtx, "customFields");
      const mergedCustom = {
        ...(existingCustom && typeof existingCustom === "object" ? (existingCustom as Record<string, unknown>) : {}),
        ...(step.fields.customFields ?? {}),
      };
      const nextFollowUp =
        step.fields.nextFollowUpInDays !== undefined
          ? new Date(Date.now() + step.fields.nextFollowUpInDays * 86_400_000)
          : undefined;
      await prisma.lead.updateMany({
        where: { id: leadId, orgId: ctx.orgId },
        data: {
          ...(step.fields.courseInterest !== undefined && { courseInterest: step.fields.courseInterest }),
          ...(step.fields.city !== undefined && { city: step.fields.city }),
          ...(step.fields.state !== undefined && { state: step.fields.state }),
          ...(nextFollowUp !== undefined && { nextFollowUp }),
          customFields: mergedCustom as Prisma.InputJsonValue,
        } as Prisma.LeadUncheckedUpdateManyInput,
      });
      await writeSystemAudit(ctx, "workflow.lead_updated", leadId, { fields: step.fields, runId: ctx.runId });
      return { ok: true };
    }

    // ── Control flow ────────────────────────────────────────────────────────
    case "START_WORKFLOW": {
      const target = await prisma.workflow.findFirst({
        where: { orgId: ctx.orgId, code: step.workflowCode, isActive: true },
        select: { id: true },
      });
      if (!target) {
        return { ok: true, skipped: true, detail: `No active workflow with code ${step.workflowCode}` };
      }
      const leadId = resolvePath(snapshotCtx, "leadId") ?? resolvePath(snapshotCtx, "id");
      const entityType = typeof leadId === "string" && leadId !== ctx.entityId ? "lead" : ctx.entityType;
      const entityId = typeof leadId === "string" ? leadId : ctx.entityId;
      const run = await prisma.workflowRun.create({
        data: {
          orgId: ctx.orgId,
          workflowId: target.id,
          entityType,
          entityId,
          triggeredBy: validUuid(ctx.actorId),
          status: "RUNNING",
          context: { startedByRunId: ctx.runId } as Prisma.InputJsonValue,
        },
      });
      void processWorkflowRunWithClaim(run.id);
      return { ok: true, detail: `started run ${run.id}` };
    }

    default:
      // WAIT / CONDITION / STOP_WORKFLOW are owned by the runner.
      return { ok: true, skipped: true, detail: `Step ${step.type} handled by runner` };
  }
}

/** STOP_WORKFLOW's stopAllForEntity fan-out (executed inside its own step). */
export async function stopAllRunsForEntity(
  orgId: string,
  entityType: string,
  entityId: string,
  reason: string,
  exceptRunId?: string,
): Promise<number> {
  const result = await prisma.workflowRun.updateMany({
    where: {
      orgId,
      entityType,
      entityId,
      status: { in: ["RUNNING", "PAUSED"] },
      ...(exceptRunId && { id: { not: exceptRunId } }),
    },
    data: { status: "STOPPED", stoppedReason: reason, stoppedAt: new Date(), completedAt: new Date() },
  });
  return result.count;
}
