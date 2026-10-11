import { prisma } from "@/lib/db/client";
import { processWorkflowRunWithClaim } from "@/lib/automation/workflow-dispatcher";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { WorkflowRepository } from "@/lib/repositories/workflow.repository";
import { NotFoundError, ConflictError } from "@/lib/utils/errors";
import { loadEntitySnapshot } from "@/lib/workflow/snapshots";
import type {
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowFilters,
  RunFilters,
} from "@/lib/validations/workflow.schema";
import type { RequestContext } from "@/types";

export class WorkflowService {
  // ─── CRUD ──────────────────────────────────────────────────────────────────

  static async list(ctx: RequestContext, filters: WorkflowFilters) {
    return WorkflowRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const workflow = await WorkflowRepository.findById(ctx.orgId, id);
    if (!workflow) throw new NotFoundError("Workflow", id);
    return workflow;
  }

  static async getByCode(ctx: RequestContext, code: string) {
    const workflow = await WorkflowRepository.findByCode(ctx.orgId, code);
    if (!workflow) throw new NotFoundError("Workflow", code);
    return workflow;
  }

  static async create(ctx: RequestContext, input: CreateWorkflowInput) {
    if (input.code) {
      const existing = await WorkflowRepository.findByCode(ctx.orgId, input.code);
      if (existing) throw new ConflictError(`Workflow code "${input.code}" is already in use`);
    }

    const workflow = await WorkflowRepository.create(ctx.orgId, input);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "workflow.created",
      entityType: "workflow",
      entityId: workflow.id,
      newValue: { name: workflow.name, triggerEvent: workflow.triggerEvent, isActive: workflow.isActive },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "automation_created",
      objectType: "workflow",
      objectId: workflow.id,
      objectSnapshot: { name: workflow.name, triggerEvent: workflow.triggerEvent },
      context: {},
    });

    return workflow;
  }

  static async update(ctx: RequestContext, id: string, input: UpdateWorkflowInput) {
    await this.getById(ctx, id);
    const workflow = await WorkflowRepository.update(ctx.orgId, id, input);
    if (!workflow) throw new NotFoundError("Workflow", id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "workflow.updated",
      entityType: "workflow",
      entityId: id,
      newValue: {
        name: workflow.name,
        isActive: workflow.isActive,
        version: workflow.version,
        stepCount: Array.isArray(workflow.steps) ? workflow.steps.length : 0,
      },
    });

    return workflow;
  }

  static async delete(ctx: RequestContext, id: string) {
    const workflow = await WorkflowRepository.delete(ctx.orgId, id);
    if (!workflow) throw new NotFoundError("Workflow", id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "workflow.deleted",
      entityType: "workflow",
      entityId: id,
      oldValue: { name: workflow.name, triggerEvent: workflow.triggerEvent },
    });

    return { id };
  }

  // ─── Runs ──────────────────────────────────────────────────────────────────

  static async listRuns(
    ctx: RequestContext,
    filters: RunFilters & { workflowId?: string },
  ) {
    return WorkflowRepository.findRuns(ctx.orgId, filters);
  }

  static async getRunById(ctx: RequestContext, runId: string) {
    const run = await WorkflowRepository.findRunById(ctx.orgId, runId);
    if (!run) throw new NotFoundError("WorkflowRun", runId);
    return run;
  }

  /**
   * Manual "Run now" — creates a dedup-free run (dedupKey NULL) for one entity
   * and hands it to the executor. The entity must exist and belong to the org.
   */
  static async runNow(
    ctx: RequestContext,
    workflowId: string,
    input: { entityType: string; entityId: string },
  ) {
    const workflow = await this.getById(ctx, workflowId);

    const snapshot = await loadEntitySnapshot(ctx.orgId, input.entityType, input.entityId);
    if (!snapshot) throw new NotFoundError(input.entityType, input.entityId);

    const run = await prisma.workflowRun.create({
      data: {
        orgId: ctx.orgId,
        workflowId: workflow.id,
        entityType: input.entityType,
        entityId: input.entityId,
        triggeredBy: ctx.user.id,
        status: "RUNNING",
        context: { manual: true, triggeredByName: ctx.user.name } as never,
      },
    });

    await processWorkflowRunWithClaim(run.id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "workflow.run_started",
      entityType: "workflow_run",
      entityId: run.id,
      newValue: { workflowId: workflow.id, entityType: input.entityType, entityId: input.entityId },
    });

    return run;
  }

  /** pause / resume / cancel a run. Resume re-enqueues the executor. */
  static async runAction(
    ctx: RequestContext,
    runId: string,
    action: "pause" | "resume" | "cancel",
  ) {
    const run = await this.getRunById(ctx, runId);

    if (["COMPLETED", "FAILED", "CANCELLED", "STOPPED"].includes(run.status)) {
      throw new ConflictError(`Run is already ${run.status} and can no longer be ${action}d`);
    }
    if (action === "resume" && run.status !== "PAUSED") {
      throw new ConflictError(`Only PAUSED runs can be resumed (current: ${run.status})`);
    }
    if (action === "pause" && run.status === "PAUSED") {
      throw new ConflictError("Run is already paused");
    }

    const nextStatus =
      action === "pause" ? "PAUSED" : action === "resume" ? "RUNNING" : "CANCELLED";

    const updated = await prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: nextStatus,
        ...(action === "pause" && { pausedAt: new Date() }),
        ...(action === "resume" && { pausedAt: null, nextRunAt: null }),
        ...(nextStatus !== "RUNNING" && nextStatus !== "PAUSED" && { completedAt: new Date() }),
        ...(action === "cancel" && { stoppedReason: `Cancelled by ${ctx.user.name}`, stoppedAt: new Date() }),
      },
    });

    if (action === "resume") {
      await processWorkflowRunWithClaim(run.id);
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: `workflow.run_${action}d`,
      entityType: "workflow_run",
      entityId: run.id,
      newValue: { status: nextStatus, workflowId: run.workflowId },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb:
        action === "pause"
          ? "automation_paused"
          : action === "resume"
            ? "automation_resumed"
            : "automation_stopped",
      objectType: "workflow_run",
      objectId: run.id,
      objectSnapshot: { entityType: run.entityType, entityId: run.entityId },
      targetType: "workflow",
      targetId: run.workflowId,
      context: {},
    });

    return updated;
  }
}
