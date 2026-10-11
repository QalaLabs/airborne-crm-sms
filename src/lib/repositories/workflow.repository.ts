import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type { CreateWorkflowInput, UpdateWorkflowInput, WorkflowFilters, RunFilters } from "@/lib/validations/workflow.schema";

const WORKFLOW_SELECT = {
  id: true,
  orgId: true,
  name: true,
  code: true,
  description: true,
  triggerEvent: true,
  triggerConditions: true,
  steps: true,
  isActive: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { runs: true } },
} satisfies Prisma.WorkflowSelect;

const RUN_SELECT = {
  id: true,
  orgId: true,
  workflowId: true,
  entityType: true,
  entityId: true,
  triggeredBy: true,
  currentStep: true,
  status: true,
  context: true,
  error: true,
  dedupKey: true,
  stoppedReason: true,
  startedAt: true,
  completedAt: true,
  workflow: { select: { id: true, name: true, code: true } },
  triggerer: { select: { id: true, name: true } },
} satisfies Prisma.WorkflowRunSelect;

export class WorkflowRepository {
  static async findMany(orgId: string, filters: WorkflowFilters) {
    const where: Prisma.WorkflowWhereInput = {
      orgId,
      ...(filters.triggerEvent && { triggerEvent: filters.triggerEvent }),
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search, mode: "insensitive" as const } },
          { code: { contains: filters.search, mode: "insensitive" as const } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      prisma.workflow.findMany({
        where,
        select: WORKFLOW_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.workflow.count({ where }),
    ]);

    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.workflow.findFirst({ where: { id, orgId }, select: WORKFLOW_SELECT });
  }

  static async findByCode(orgId: string, code: string) {
    return prisma.workflow.findUnique({ where: { orgId_code: { orgId, code } }, select: WORKFLOW_SELECT });
  }

  static async create(orgId: string, input: CreateWorkflowInput) {
    return prisma.workflow.create({
      data: {
        orgId,
        name: input.name,
        ...(input.code !== undefined && { code: input.code }),
        description: input.description,
        triggerEvent: input.triggerEvent,
        triggerConditions: (input.triggerConditions ?? {}) as Prisma.InputJsonValue,
        steps: input.steps as Prisma.InputJsonValue,
        isActive: input.isActive,
      },
      select: WORKFLOW_SELECT,
    });
  }

  static async update(orgId: string, id: string, input: UpdateWorkflowInput) {
    const existing = await prisma.workflow.findFirst({ where: { id, orgId }, select: { id: true } });
    if (!existing) return null;

    const touchesDefinition =
      input.steps !== undefined || input.triggerEvent !== undefined || input.triggerConditions !== undefined;

    return prisma.workflow.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.code !== undefined && { code: input.code }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.triggerEvent !== undefined && { triggerEvent: input.triggerEvent }),
        ...(input.triggerConditions !== undefined && {
          triggerConditions: (input.triggerConditions ?? {}) as Prisma.InputJsonValue,
        }),
        ...(input.steps !== undefined && { steps: input.steps as Prisma.InputJsonValue }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(touchesDefinition && { version: { increment: 1 } }),
      },
      select: WORKFLOW_SELECT,
    });
  }

  static async delete(orgId: string, id: string) {
    const existing = await prisma.workflow.findFirst({ where: { id, orgId }, select: { ...WORKFLOW_SELECT } });
    if (!existing) return null;
    await prisma.workflow.delete({ where: { id } });
    return existing;
  }

  // ─── Runs ──────────────────────────────────────────────────────────────────

  static async findRuns(
    orgId: string,
    filters: RunFilters & { workflowId?: string },
  ) {
    const where: Prisma.WorkflowRunWhereInput = {
      orgId,
      ...(filters.workflowId && { workflowId: filters.workflowId }),
      ...(filters.status && { status: filters.status }),
      ...(filters.entityType && { entityType: filters.entityType }),
      ...(filters.entityId && { entityId: filters.entityId }),
    };

    const [data, total] = await Promise.all([
      prisma.workflowRun.findMany({
        where,
        select: RUN_SELECT,
        orderBy: { startedAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.workflowRun.count({ where }),
    ]);

    return { data, total };
  }

  static async findRunById(orgId: string, id: string) {
    return prisma.workflowRun.findFirst({ where: { id, orgId }, select: RUN_SELECT });
  }
}
