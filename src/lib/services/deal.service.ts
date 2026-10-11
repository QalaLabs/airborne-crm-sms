import { DealRepository } from "@/lib/repositories/deal.repository";
import { emitEvent } from "@/lib/events/inngest";
import { prisma } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import type { Prisma, AdmissionStage } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/utils/errors";
import type { CreateDealInput, UpdateDealInput, ConvertDealInput, RevertDealInput } from "@/lib/validations/deal.schema";
import type { RequestContext } from "@/types";
import { canTransitionDealStage, LOSS_REASON_DEFAULT } from "@/lib/validations/deal.schema";
import type { DealFilters } from "@/lib/validations/deal.schema";
import type { LeadStatus, LeadSource } from "@prisma/client";

import { isActiveAdmissionStage } from "@/lib/services/deal-admission-link";

const WON_STAGES: AdmissionStage[] = ["ENROLLED"];

async function setLeadStatusWithTimeline(
  ctx: RequestContext,
  leadId: string,
  status: LeadStatus,
  title: string,
  metadata: Record<string, unknown>,
) {
  const before = await prisma.lead.findFirst({
    where: { id: leadId, orgId: ctx.orgId },
    select: { status: true },
  });
  if (!before) return;
  await prisma.$transaction([
    prisma.lead.update({
      where: { id: leadId, orgId: ctx.orgId },
      data: { status, lastActivityAt: new Date() },
    }),
    prisma.leadActivity.create({
      data: {
        leadId,
        orgId: ctx.orgId,
        performedBy: ctx.user.id,
        activityType: "STATUS_CHANGE",
        title,
        completedAt: new Date(),
        metadata: { ...metadata, oldStatus: before.status, newStatus: status } as Prisma.InputJsonValue,
      },
    }),
  ]);
}
const LOST_STAGES: AdmissionStage[] = ["DROPPED", "CANCELLED"];

/**
 * Course / batch / fee plan / fee decided at Prospect time (stored on the deal)
 * carried into the admission dossier. References are re-checked against the org.
 */
export async function resolveDecidedTerms(
  orgId: string,
  deal: { value?: unknown; metadata?: unknown },
): Promise<{ courseId?: string; batchId?: string; feePlanId?: string; feeAmount?: number }> {
  const meta = (deal.metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
  let courseId = str(meta.courseId);
  let batchId = str(meta.batchId);
  let feePlanId = str(meta.feePlanId);

  let courseFee: number | undefined;
  if (courseId) {
    const course = await prisma.course.findFirst({ where: { id: courseId, orgId }, select: { fee: true } });
    if (!course) courseId = undefined;
    else if (course.fee != null && Number(course.fee) > 0) courseFee = Number(course.fee);
  }
  if (batchId) {
    const batch = await prisma.lmsBatch.findFirst({ where: { id: batchId, orgId }, select: { id: true } });
    if (!batch) batchId = undefined;
  }
  if (feePlanId) {
    const plan = await prisma.feePlan.findFirst({ where: { id: feePlanId, orgId, isActive: true }, select: { id: true } });
    if (!plan) feePlanId = undefined;
  }

  const dealValue = Number(deal.value ?? 0);
  const feeAmount = Number.isFinite(dealValue) && dealValue > 0 ? dealValue : courseFee;
  return { courseId, batchId, feePlanId, feeAmount };
}

export type DealStatus = "open" | "won" | "lost" | "archived";

function requireDealStatus(deal: { isActive: boolean; wonAt: Date | null; lostAt: Date | null }): DealStatus {
  if (deal.lostAt) return "lost";
  if (deal.wonAt) return "won";
  if (deal.isActive) return "open";
  return "archived";
}

export class DealService {
  static async list(ctx: RequestContext, filters: DealFilters) {
    return DealRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const deal = await DealRepository.findById(ctx.orgId, id);
    if (!deal) throw new NotFoundError("Deal", id);
    return deal;
  }

  /**
   * Ensure a Deal exists for the given lead. Called by LeadService when a lead
   * enters PROSPECT. Idempotent: if an active deal exists, return it. If a
   * closed/won deal exists, throw — the lead cannot re-enter PROSPECT without
   * a revert first (the caller's responsibility).
   */
  static async ensureDealForLead(
    ctx: RequestContext,
    leadId: string,
    input: { 
      title: string; 
      source?: LeadSource; 
      assignedTo?: string;
      courseId?: string | null;
      batchId?: string | null;
      feePlanId?: string | null;
      value?: number | null;
    },
  ) {
    const existing = await DealRepository.findActiveByLeadId(ctx.orgId, leadId);
    if (existing) {
      // Merge course / batch / fee when counselor re-confirms PROSPECT details
      if (
        input.courseId !== undefined ||
        input.batchId !== undefined ||
        input.feePlanId !== undefined ||
        input.value != null
      ) {
        const updated = await DealRepository.update(ctx.orgId, existing.id, {
          ...(input.courseId !== undefined ? { courseId: input.courseId } : {}),
          ...(input.batchId !== undefined ? { batchId: input.batchId } : {}),
          ...(input.feePlanId !== undefined ? { feePlanId: input.feePlanId } : {}),
          ...(input.value != null ? { value: input.value } : {}),
        });
        return { deal: updated, created: false };
      }
      return { deal: existing, created: false };
    }

    const closedDeal = await prisma.deal.findFirst({
      where: { leadId, orgId: ctx.orgId, deletedAt: null, isActive: false },
      select: { id: true, stage: true, wonAt: true, lostAt: true, revertedAt: true },
    });
    if (closedDeal?.revertedAt) {
      // Legacy: deals archived by the previous revert behaviour are reopened.
      await prisma.deal.update({
        where: { id: closedDeal.id, orgId: ctx.orgId },
        data: { isActive: true, stage: "ENQUIRY", wonAt: null, lostAt: null, lostReason: null },
      });
      const reopened = await DealRepository.update(ctx.orgId, closedDeal.id, {
        ...(input.courseId !== undefined ? { courseId: input.courseId } : {}),
        ...(input.batchId !== undefined ? { batchId: input.batchId } : {}),
        ...(input.feePlanId !== undefined ? { feePlanId: input.feePlanId } : {}),
        ...(input.value != null ? { value: input.value } : {}),
      });
      return { deal: reopened, created: false };
    }
    if (closedDeal) {
      throw new ValidationError([
        {
          message:
            "A closed deal exists for this lead. Revert it to Prospect before creating a new deal.",
        },
      ]);
    }

    return this.create(ctx, {
      leadId,
      title: input.title,
      source: input.source,
      assignedTo: input.assignedTo,
      courseId: input.courseId,
      batchId: input.batchId,
      feePlanId: input.feePlanId,
      value: input.value != null ? input.value : undefined,
      stage: "ENQUIRY",
      currency: "INR",
    });
  }

  static async create(ctx: RequestContext, input: CreateDealInput) {
    let deal: Awaited<ReturnType<typeof DealRepository.create>>;
    try {
      deal = await DealRepository.create(ctx.orgId, {
        ...input,
        createdBy: ctx.user.id,
      });
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: string }).code === "P2002"
      ) {
        // Concurrent conversion to the same lead — converge on the existing row.
        const existing = await DealRepository.findActiveByLeadId(ctx.orgId, input.leadId);
        if (existing) return { deal: existing, created: false };
        throw new ConflictError("A deal for this lead already exists");
      }
      throw err;
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "deal.created",
      entityType: "deal",
      entityId: deal.id,
      newValue: { title: deal.title, stage: deal.stage, leadId: input.leadId },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "created",
      objectType: "deal",
      objectId: deal.id,
      objectSnapshot: { title: deal.title, stage: deal.stage, leadId: input.leadId },
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "deal/created",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        dealId: deal.id,
        leadId: input.leadId,
        title: deal.title,
        stage: deal.stage,
      },
    });

    return { deal, created: true };
  }

  static async update(ctx: RequestContext, id: string, input: UpdateDealInput) {
    const existing = await this.getById(ctx, id);

    if (existing.wonAt || existing.lostAt) {
      throw new ValidationError([
        { message: "Cannot modify a closed Lead Pipeline entry. Revert it to open first." },
      ]);
    }

    if (input.stage && input.stage !== existing.stage) {
      if (!canTransitionDealStage(existing.stage, input.stage)) {
        throw new ValidationError([
          {
            message: `Cannot move this Lead Pipeline entry from ${existing.stage} to ${input.stage}`,
          },
        ]);
      }
    }

    // Winning a deal must always go through the admission conversion so the
    // lead never becomes WON without an Admission Application Dossier.
    if (input.stage && input.stage !== existing.stage && WON_STAGES.includes(input.stage as AdmissionStage)) {
      const linked = existing.admissionId
        ? await prisma.admission.findFirst({
            where: { id: existing.admissionId, orgId: ctx.orgId },
            select: { stage: true },
          })
        : null;
      if (!isActiveAdmissionStage(linked?.stage)) {
        await this.convertToAdmission(ctx, id, {});
        return this.getById(ctx, id);
      }
    }

    const updated = await DealRepository.update(ctx.orgId, id, input);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "deal.updated",
      entityType: "deal",
      entityId: id,
      oldValue: { stage: existing.stage },
      newValue: { stage: updated.stage, title: updated.title },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "updated",
      objectType: "deal",
      objectId: id,
      objectSnapshot: { title: updated.title, stage: updated.stage },
      context: { from: existing.stage, to: updated.stage, actorName: ctx.user.name },
    });

    if (input.stage && input.stage !== existing.stage) {
      await emitEvent({
        name: "deal/stage.changed",
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        requestId: ctx.requestId,
        timestamp: new Date().toISOString(),
        data: {
          dealId: id,
          fromStage: existing.stage,
          toStage: updated.stage,
          leadId: existing.leadId,
        },
      });

      if (WON_STAGES.includes(updated.stage as AdmissionStage)) {
        await this.markWon(ctx, updated, existing);
      } else if (LOST_STAGES.includes(updated.stage as AdmissionStage)) {
        await this.markLost(ctx, updated, existing);
      }
    }

    // markWon/markLost run after the repo update, so re-read to return the
    // freshly updated row (wonAt/lostAt otherwise appear stale).
    return this.getById(ctx, id);
  }

  static async changeStage(ctx: RequestContext, id: string, toStage: AdmissionStage, notes?: string) {
    return this.update(ctx, id, { stage: toStage, notes });
  }

  static async convertToAdmission(ctx: RequestContext, id: string, input: ConvertDealInput) {
    const deal = await this.getById(ctx, id);
    const { AdmissionService } = await import("@/lib/services/admission.service");

    if (deal.admissionId) {
      const existingAdmission = await prisma.admission.findFirst({
        where: { id: deal.admissionId, orgId: ctx.orgId },
        select: { id: true, stage: true, applicationNo: true },
      });
      if (existingAdmission && !["DROPPED", "CANCELLED"].includes(existingAdmission.stage)) {
        return { admission: existingAdmission, created: false };
      }
    }

    const decided = await resolveDecidedTerms(ctx.orgId, deal);
    const feeAmount = input.feeAmount ?? decided.feeAmount;
    const admission = await AdmissionService.create(ctx, {
      leadId: deal.leadId,
      courseName: input.courseName ?? (decided.courseId ? undefined : deal.lead?.courseInterest ?? undefined),
      courseId: decided.courseId,
      batchId: decided.batchId,
      // Percentage fee plans need a base fee; skip the plan rather than fail conversion.
      feePlanId: feeAmount !== undefined ? decided.feePlanId : undefined,
      counselorId: input.counselorId ?? deal.assignedTo ?? undefined,
      campusId: input.campusId ?? deal.lead?.campusId ?? undefined,
      feeAmount,
      feeDiscount: 0,
      notes: input.notes,
    });

    const { linkAdmissionToDeal } = await import("@/lib/services/deal-admission-link");
    const link = await linkAdmissionToDeal({
      orgId: ctx.orgId,
      dealId: id,
      expectedPrevious: deal.admissionId ?? null,
      admissionId: admission.id,
      data: { convertedAt: new Date(), stage: "ENROLLED" as AdmissionStage, wonAt: new Date() },
    });

    let saved: { admission: { id: string; applicationNo: string; stage: string }; created: boolean };
    if (link.linked) {
      saved = { admission: { id: admission.id, applicationNo: admission.applicationNo, stage: admission.stage }, created: true };
    } else {
      const winner = link.admissionId
        ? await prisma.admission.findFirst({
            where: { id: link.admissionId, orgId: ctx.orgId },
            select: { id: true, stage: true, applicationNo: true },
          })
        : null;
      if (!winner) {
        throw new ValidationError([{ message: "Concurrent conversion in progress. Please retry." }]);
      }
      return { admission: winner, created: false };
    }

    const savedAdmission = saved.admission;

    await setLeadStatusWithTimeline(ctx, deal.leadId, "WON" as LeadStatus, "Converted to admission", {
      admissionId: savedAdmission.id,
      dealId: id,
      applicationNo: savedAdmission.applicationNo,
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "deal.converted_to_admission",
      entityType: "deal",
      entityId: id,
      newValue: { admissionId: savedAdmission.id, applicationNo: savedAdmission.applicationNo },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "converted",
      objectType: "deal",
      objectId: id,
      objectSnapshot: { title: deal.title, applicationNo: savedAdmission.applicationNo },
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "deal/converted_to_admission",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        dealId: id,
        admissionId: savedAdmission.id,
        applicationNo: savedAdmission.applicationNo,
        leadId: deal.leadId,
      },
    });

    return saved;
  }

  static async revertToProspect(ctx: RequestContext, id: string, input?: RevertDealInput) {
    const deal = await this.getById(ctx, id);

    if (deal.isActive && deal.stage === "ENQUIRY" && !deal.wonAt && !deal.lostAt && !deal.admissionId) {
      throw new ValidationError([{ message: "This lead is already at the Prospect stage of the Lead Pipeline." }]);
    }

    // Revert reopens the same deal at the Prospect stage (one deal per lead is a
    // unique constraint, so archiving would leave the lead with no reachable deal).
    // The admission, if any, is kept — only the link is cleared.
    const archived = await prisma.deal.update({
      where: { id, orgId: ctx.orgId },
      data: {
        isActive: true,
        stage: "ENQUIRY",
        wonAt: null,
        lostAt: null,
        lostReason: null,
        revertedAt: new Date(),
        notes: input?.notes ?? deal.notes,
        admissionId: null,
        convertedAt: null,
      },
    });

    // Restore lead to PROSPECT (schema / product: revert deal → prospect stage)
    await setLeadStatusWithTimeline(ctx, deal.leadId, "PROSPECT" as LeadStatus, "Deal reverted to Prospect", {
      dealId: id,
      fromStage: deal.stage,
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "deal.reverted_to_prospect",
      entityType: "deal",
      entityId: id,
      oldValue: { stage: deal.stage },
      newValue: { revertedAt: new Date().toISOString() },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "reverted",
      objectType: "deal",
      objectId: id,
      objectSnapshot: { title: deal.title, stage: deal.stage },
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "deal/reverted_to_prospect",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: { dealId: id, leadId: deal.leadId },
    });

    return archived;
  }

  static async markWon(
    ctx: RequestContext,
    updated: { id: string; stage: AdmissionStage },
    existing: { id: string; leadId: string; stage: AdmissionStage; wonAt: Date | null; lostAt: Date | null },
  ) {
    if (existing.wonAt) return; // idempotent
    await prisma.deal.update({
      where: { id: updated.id, orgId: ctx.orgId },
      data: { wonAt: new Date() },
    });
    await setLeadStatusWithTimeline(ctx, existing.leadId, "WON" as LeadStatus, "Deal won", {
      dealId: updated.id,
      stage: updated.stage,
    });
  }

  static async markLost(
    ctx: RequestContext,
    updated: { id: string; stage: AdmissionStage },
    existing: { id: string; stage: AdmissionStage; wonAt: Date | null; lostAt: Date | null },
  ) {
    if (existing.lostAt) return; // idempotent
    const deal = await DealRepository.findById(ctx.orgId, updated.id);
    const lostReason = deal?.lostReason ?? LOSS_REASON_DEFAULT;
    await prisma.deal.update({
      where: { id: updated.id, orgId: ctx.orgId },
      data: { lostAt: new Date(), lostReason },
    });
  }

  static async assign(ctx: RequestContext, id: string, counselorId: string) {
    const deal = await this.getById(ctx, id);

    const counselor = await prisma.user.findFirst({
      where: { id: counselorId, orgId: ctx.orgId, isActive: true },
      select: { id: true, name: true },
    });
    if (!counselor) throw new NotFoundError("Counselor", counselorId);

    await DealRepository.update(ctx.orgId, id, { assignedTo: counselorId });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "deal.assigned",
      entityType: "deal",
      entityId: id,
      newValue: { counselorId, counselorName: counselor.name },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "assigned",
      objectType: "deal",
      objectId: id,
      objectSnapshot: { title: deal.title },
      context: { counselorId, counselorName: counselor.name, actorName: ctx.user.name },
    });

    await emitEvent({
      name: "deal/assigned",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: { dealId: id, counselorId, counselorName: counselor.name },
    });

    return { ok: true };
  }

  static async delete(ctx: RequestContext, id: string) {
    await this.getById(ctx, id);
    await DealRepository.softDelete(ctx.orgId, id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "deal.deleted",
      entityType: "deal",
      entityId: id,
    });

    return { ok: true };
  }

  static async getPipelineSummary(ctx: RequestContext) {
    return DealRepository.getPipelineSummary(ctx.orgId);
  }
}