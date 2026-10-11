import { prisma } from "@/lib/db/client";
import { FeePlanRepository } from "@/lib/repositories/fee-plan.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/utils/errors";
import { computePlanTotal, type PlanComputation, type PlanItemInput } from "@/lib/services/fee-calculation.service";
import type { CreateFeePlanInput, UpdateFeePlanInput, FeePlanFilters } from "@/lib/validations/fee-plan.schema";
import type { RequestContext } from "@/types";

export class FeePlanService {
  static async list(ctx: RequestContext, filters: FeePlanFilters) {
    return FeePlanRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const plan = await FeePlanRepository.findById(ctx.orgId, id);
    if (!plan) throw new NotFoundError("FeePlan", id);
    return plan;
  }

  /** A fee plan may only reference a course of the same organization. */
  static async assertCourseInOrg(orgId: string, courseId: string | null | undefined): Promise<void> {
    if (!courseId) return;
    const course = await prisma.course.findFirst({ where: { id: courseId, orgId }, select: { id: true } });
    if (!course) {
      throw new ValidationError([{ path: ["courseId"], message: "Course not found in this organization" }]);
    }
  }

  static async create(ctx: RequestContext, input: CreateFeePlanInput) {
    await this.assertCourseInOrg(ctx.orgId, input.courseId);
    const plan = await FeePlanRepository.create(ctx.orgId, input);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "fee_plan.created",
      entityType: "fee_plan",
      entityId: plan.id,
      newValue: { name: plan.name, itemCount: plan.items.length, courseId: plan.courseId },
    });

    return plan;
  }

  /**
   * Re-mapping a plan's course only changes the plan. Admissions keep the fee
   * snapshot captured when they were created (admission.metadata.feePlanSnapshot).
   */
  static async update(ctx: RequestContext, id: string, input: UpdateFeePlanInput) {
    const before = await this.getById(ctx, id);
    if (input.courseId !== undefined) await this.assertCourseInOrg(ctx.orgId, input.courseId);
    const plan = await FeePlanRepository.update(ctx.orgId, id, input);
    if (!plan) throw new NotFoundError("FeePlan", id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "fee_plan.updated",
      entityType: "fee_plan",
      entityId: id,
      oldValue: { name: before.name, isActive: before.isActive, courseId: before.courseId },
      newValue: { name: plan.name, isActive: plan.isActive, courseId: plan.courseId },
    });

    return plan;
  }

  /**
   * Permanently delete a fee plan and its items (SUPER_ADMIN only). Admissions
   * keep their fee snapshot; their feePlanId is cleared by the FK (SET NULL).
   */
  static async remove(ctx: RequestContext, id: string) {
    if (ctx.user.role !== "SUPER_ADMIN") {
      throw new ForbiddenError("delete", "fee plans");
    }
    const before = await this.getById(ctx, id);
    const admissionCount = before._count?.admissions ?? 0;

    await prisma.feePlan.delete({ where: { id: before.id } });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "fee_plan.deleted",
      entityType: "fee_plan",
      entityId: id,
      oldValue: {
        name: before.name,
        courseId: before.courseId,
        isActive: before.isActive,
        items: before.items.map((i) => ({
          name: i.name,
          amount: String(i.amount),
          percentOfFee: i.percentOfFee != null ? String(i.percentOfFee) : null,
          dueOffsetDays: i.dueOffsetDays,
        })),
        linkedAdmissions: admissionCount,
      },
    });

    return { id, unlinkedAdmissions: admissionCount };
  }

  /**
   * Total rupee amount of a plan given the base course fee. A plan with percent
   * items is unresolved (needsBaseFee) until a base fee is supplied.
   */
  static planComputation(
    items: PlanItemInput[],
    baseFee?: number | string | null,
  ): PlanComputation {
    return computePlanTotal(items, baseFee);
  }

  /** Whether a plan contains at least one percent-of-fee item. */
  static hasPercentItems(items: PlanItemInput[]): boolean {
    return items.some((i) => i.percentOfFee !== null && i.percentOfFee !== undefined);
  }
}
