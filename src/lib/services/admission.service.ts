import { AdmissionRepository, ADMISSION_SELECT } from "@/lib/repositories/admission.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { FeePlanService } from "@/lib/services/fee-plan.service";
import { emitEvent } from "@/lib/events/inngest";
import { NotFoundError, ValidationError } from "@/lib/utils/errors";
import { STAGE_TRANSITIONS } from "@/lib/validations/admission.schema";
import { prisma } from "@/lib/db/client";
import type { Prisma, FeePlan } from "@prisma/client";
import type {
  CreateAdmissionInput,
  UpdateAdmissionInput,
  ChangeStageInput,
  AdmissionFilters,
} from "@/lib/validations/admission.schema";
import type { AdmissionStage } from "@prisma/client";
import type { RequestContext } from "@/types";

function splitLeadName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Student", lastName: "-" };
  const firstName = parts[0] ?? "Student";
  if (parts.length === 1) return { firstName, lastName: "-" };
  return { firstName, lastName: parts.slice(1).join(" ") };
}

/**
 * Phase D/E — auto-provide the Student from the admission's lead inside the
 * enrollment transaction. Shares the tx's commit/rollback fate, so a racing
 * capacity loss never orphans a student row.
 */
async function provisionStudentInTx(
  ctx: RequestContext,
  tx: Prisma.TransactionClient,
  admission: { leadId: string; applicationNo: string; campusId?: string | null },
  input: ChangeStageInput,
): Promise<string | undefined> {
  const existing = await tx.student.findFirst({
    where: { leadId: admission.leadId, orgId: ctx.orgId, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (input.createStudent === false) return undefined;

  const lead = await tx.lead.findFirst({
    where: { id: admission.leadId, orgId: ctx.orgId, deletedAt: null },
    select: { name: true, email: true, phone: true },
  });
  if (!lead) throw new NotFoundError("Lead", admission.leadId);

  const { firstName, lastName } = splitLeadName(lead.name);
  const email =
    lead.email?.trim() || `student+${admission.applicationNo.toLowerCase()}@airborne.local`;

  // Collision-resistant studentCode: one admission → one application number →
  // one student. Avoids the count-based code race that would otherwise abort
  // this transaction via the (orgId, studentCode) unique constraint.
  const studentCode = `STU-${admission.applicationNo}`;

  const student = await tx.student.create({
    data: {
      orgId: ctx.orgId,
      studentCode,
      firstName,
      lastName,
      email: email.toLowerCase(),
      phone: lead.phone,
      nationality: "Indian",
      medicalFitness: false,
      leadId: admission.leadId,
      ...(admission.campusId ? { campusId: admission.campusId } : {}),
    },
    select: { id: true },
  });
  return student.id;
}

/** Normalize fee-plan items (Prisma Decimals) into the pure computation types. */
function toPlanItems(items: { amount: unknown; percentOfFee?: unknown; dueOffsetDays: number }[]) {
  return items.map((i) => ({
    ...(i.amount != null ? { amount: Number(i.amount) } : {}),
    ...(i.percentOfFee != null ? { percentOfFee: Number(i.percentOfFee) } : {}),
    dueOffsetDays: i.dueOffsetDays,
  }));
}

/**
 * Phase N — build an immutable snapshot of the fee plan as applied to this
 * admission. Percent items are resolved against the base course fee so the
 * dossier always reproduces the exact historical financial terms, even if the
 * master plan is later edited or re-priced.
 */
export function buildFeePlanSnapshot(
  plan: FeePlan & { items: { name: string; amount: unknown; percentOfFee?: unknown; dueOffsetDays: number; sortOrder: number }[] },
  baseFee: number | null,
  appliedBy: string,
  appliedAt: string,
) {
  const items = plan.items.map((i) => {
    const pct = i.percentOfFee != null ? Number(i.percentOfFee) : null;
    const amt = i.amount != null ? Number(i.amount) : null;
    const resolved =
      pct != null
        ? baseFee != null
          ? Math.round((pct / 100) * baseFee * 100) / 100
          : null
        : amt;
    return {
      name: i.name,
      amount: amt,
      percentOfFee: pct,
      dueOffsetDays: i.dueOffsetDays,
      sortOrder: i.sortOrder,
      resolvedAmount: resolved,
    };
  });
  return {
    planId: plan.id,
    name: plan.name,
    courseId: plan.courseId ?? null,
    currency: plan.currency ?? "INR",
    isActive: plan.isActive,
    appliedAt,
    appliedBy,
    items,
  };
}

async function resolveCampus(ctx: RequestContext, campusId: string) {
  const campus = await prisma.campus.findFirst({
    where: { id: campusId, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!campus) throw new NotFoundError("Campus", campusId);
}

async function resolveCourse(ctx: RequestContext, courseId: string) {
  const course = await prisma.course.findFirst({
    where: { id: courseId, orgId: ctx.orgId },
    select: { id: true, title: true },
  });
  if (!course) throw new NotFoundError("Course", courseId);
  return course;
}

async function resolveBatch(ctx: RequestContext, batchId: string) {
  const batch = await prisma.lmsBatch.findFirst({
    where: { id: batchId, orgId: ctx.orgId },
    select: { id: true, name: true, startDate: true },
  });
  if (!batch) throw new NotFoundError("LmsBatch", batchId);
  return batch;
}

export class AdmissionService {
  static async list(ctx: RequestContext, filters: AdmissionFilters) {
    return AdmissionRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const admission = await AdmissionRepository.findById(ctx.orgId, id);
    if (!admission) throw new NotFoundError("Admission", id);
    return admission;
  }

  static async create(ctx: RequestContext, input: CreateAdmissionInput) {
    const lead = await prisma.lead.findFirst({
      where: { id: input.leadId, orgId: ctx.orgId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!lead) throw new NotFoundError("Lead", input.leadId);

    if (input.counselorId) {
      const counselor = await prisma.user.findFirst({
        where: { id: input.counselorId, orgId: ctx.orgId, isActive: true },
      });
      if (!counselor) throw new NotFoundError("Counselor", input.counselorId);
    }

    // Every reference must belong to this org (never trust caller-provided ids).
    if (input.campusId) await resolveCampus(ctx, input.campusId);

    // Phase M — canonical course: courseId points at the Course content model
    // whose title doubles as the dossier course name.
    let courseName = input.courseName;
    if (input.courseId) {
      const course = await resolveCourse(ctx, input.courseId);
      if (!courseName) courseName = course.title;
    }

    // Phase H — canonical batch: batchId points at LmsBatch; name/start date
    // are derived from the batch so the free-text columns cannot drift.
    let batchName = input.batchName;
    let batchStartDate = input.batchStartDate;
    if (input.batchId) {
      const batch = await resolveBatch(ctx, input.batchId);
      batchName = batch.name;
      batchStartDate = batch.startDate ? batch.startDate.toISOString() : undefined;
    }

    let createInput: CreateAdmissionInput & {
      feeFinal?: number | null;
      courseName?: string;
      batchName?: string;
      batchStartDate?: string;
    } = {
      ...input,
      feeFinal: undefined,
      courseName,
      batchName,
      batchStartDate,
    };
    const metadata = { ...(input.metadata ?? {}) } as Record<string, unknown>;

    if (input.feePlanId) {
      const plan = await FeePlanService.getById(ctx, input.feePlanId);
      if (!plan.isActive) {
        throw new ValidationError([{ message: "Fee plan is inactive" }]);
      }
      const itemInputs = toPlanItems(plan.items);
      const hasPercent = FeePlanService.hasPercentItems(itemInputs);

      if (hasPercent) {
        // Percent-of-course-fee items resolve against the base course fee.
        if (createInput.feeAmount === undefined) {
          throw new ValidationError([
            {
              message:
                "This fee plan uses percentage-based items — it requires the course fee (feeAmount)",
            },
          ]);
        }
        const { total, needsBaseFee } = FeePlanService.planComputation(itemInputs, createInput.feeAmount);
        if (needsBaseFee) {
          throw new ValidationError([{ message: "Fee plan could not be resolved against the course fee" }]);
        }
        const discount = createInput.feeDiscount ?? 0;
        createInput.feeDiscount = discount;
        createInput.feeFinal = Math.round((total - discount) * 100) / 100;
        if (createInput.feeFinal < 0) {
          throw new ValidationError([{ message: "Fee discount exceeds the fee plan total" }]);
        }
      } else {
        const { total } = FeePlanService.planComputation(itemInputs, undefined);
        createInput = {
          ...createInput,
          feeAmount: createInput.feeAmount ?? total,
          feeDiscount: createInput.feeDiscount ?? 0,
        };
        createInput.feeFinal = Math.round((Number(createInput.feeAmount) - createInput.feeDiscount) * 100) / 100;
      }

      // Phase N — snapshot the applied plan so later master-plan edits never
      // rewrite the admission's financial terms.
      metadata.feePlanSnapshot = buildFeePlanSnapshot(
        plan,
        createInput.feeAmount != null ? Number(createInput.feeAmount) : null,
        ctx.user.id,
        new Date().toISOString(),
      );
    }

    const applicationNo = await AdmissionRepository.getNextApplicationNo(ctx.orgId);
    const admission = await AdmissionRepository.create(ctx.orgId, {
      ...createInput,
      applicationNo,
      metadata,
      feeFinal: createInput.feeFinal,
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "admission.created",
      entityType: "admission",
      entityId: admission.id,
      newValue: {
        applicationNo,
        leadId: input.leadId,
        stage: "ENQUIRY",
        courseId: input.courseId,
        batchId: input.batchId,
        feePlanId: input.feePlanId,
        feeFinal: createInput.feeFinal,
      },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "created",
      objectType: "admission",
      objectId: admission.id,
      objectSnapshot: { applicationNo, leadName: lead.name },
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "admission/created",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        admissionId: admission.id,
        applicationNo,
        leadId: input.leadId,
        leadName: lead.name,
        campusId: input.campusId,
        courseId: input.courseId,
        batchId: input.batchId,
      },
    });

    return admission;
  }

  static async update(ctx: RequestContext, id: string, input: UpdateAdmissionInput) {
    const existing = await this.getById(ctx, id);
    const existingMeta = (existing.metadata ?? {}) as Record<string, unknown>;

    // D-01: never trust a caller-supplied studentId — verify it belongs to this org
    if (input.studentId) {
      const student = await prisma.student.findFirst({
        where: { id: input.studentId, orgId: ctx.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!student) throw new NotFoundError("Student", input.studentId);
    }

    if (input.campusId !== undefined && input.campusId !== null) {
      await resolveCampus(ctx, input.campusId);
    }
    if (input.courseId !== undefined && input.courseId !== null) {
      await resolveCourse(ctx, input.courseId);
    }
    if (input.batchId !== undefined && input.batchId !== null) {
      await resolveBatch(ctx, input.batchId);
    }

    // Phase M — financial integrity: once money has moved, the course is frozen.
    const hasPaid = Number(existing.feePaid ?? 0) > 0;
    if (
      hasPaid &&
      ((input.courseId !== undefined && input.courseId !== existing.courseId) ||
        (input.courseName !== undefined && input.courseName !== existing.courseName))
    ) {
      throw new ValidationError([
        { message: "Cannot change the course after payments have been recorded" },
      ]);
    }

    const updateInput: Omit<UpdateAdmissionInput, "batchName"> & { feeFinal?: number | null; batchName?: string | null } = {
      ...input,
      feeFinal: undefined,
    };

    // Phase H — when a batch is (re)selected, name/start date follow the batch.
    if (input.batchId !== undefined && input.batchId !== null) {
      const batch = await resolveBatch(ctx, input.batchId);
      updateInput.batchName = batch.name;
      updateInput.batchStartDate = batch.startDate ? batch.startDate.toISOString() : null;
    } else if (input.batchId === null) {
      // Batch removed — derived name/start date go with it.
      updateInput.batchId = null;
      updateInput.batchName = null;
      updateInput.batchStartDate = null;
    }
    if (input.courseId !== undefined && input.courseId !== null) {
      const course = await resolveCourse(ctx, input.courseId);
      if (updateInput.courseName === undefined) updateInput.courseName = course.title;
    }

    let feeRelated = false;
    if (input.feePlanId) {
      const plan = await FeePlanService.getById(ctx, input.feePlanId);
      if (!plan.isActive) {
        throw new ValidationError([{ message: "Fee plan is inactive" }]);
      }
      const itemInputs = toPlanItems(plan.items);
      const hasPercent = FeePlanService.hasPercentItems(itemInputs);

      if (hasPercent) {
        // Percent items resolve against the stored/provided course fee.
        const base =
          updateInput.feeAmount != null
            ? Number(updateInput.feeAmount)
            : existing.feeAmount != null
              ? Number(existing.feeAmount)
              : null;
        if (base === null || base === undefined) {
          throw new ValidationError([
            {
              message:
                "This fee plan uses percentage-based items — it requires the course fee (feeAmount)",
            },
          ]);
        }
        const { total, needsBaseFee } = FeePlanService.planComputation(itemInputs, base);
        if (needsBaseFee) {
          throw new ValidationError([{ message: "Fee plan could not be resolved against the course fee" }]);
        }
        if (updateInput.feeDiscount === undefined) {
          updateInput.feeDiscount = Number(existing.feeDiscount ?? 0);
        }
        updateInput.feeFinal = Math.round((total - updateInput.feeDiscount) * 100) / 100;
        if (updateInput.feeFinal < 0) {
          throw new ValidationError([{ message: "Fee discount exceeds the fee plan total" }]);
        }
      } else {
        const { total } = FeePlanService.planComputation(itemInputs, undefined);
        if (updateInput.feeAmount === undefined) {
          updateInput.feeAmount = total;
        }
        updateInput.feeFinal = Math.round((Number(updateInput.feeAmount) - (updateInput.feeDiscount ?? Number(existing.feeDiscount ?? 0))) * 100) / 100;
      }
      feeRelated = true;
    } else if (
      input.feeAmount !== undefined ||
      input.feeDiscount !== undefined
    ) {
      feeRelated = true;
    }

    // Phase N — refresh the snapshot whenever financial terms change, so the
    // dossier reflects exactly what was applied at this moment.
    if (feeRelated) {
      const effectivePlanId = updateInput.feePlanId ?? existing.feePlanId;
      const effectiveBase =
        updateInput.feeAmount != null
          ? Number(updateInput.feeAmount)
          : existing.feeAmount != null
            ? Number(existing.feeAmount)
            : null;
      if (effectivePlanId) {
        const plan = await FeePlanService.getById(ctx, effectivePlanId);
        existingMeta.feePlanSnapshot = buildFeePlanSnapshot(
          plan,
          effectiveBase,
          ctx.user.id,
          new Date().toISOString(),
        );
      }
    }

    const metadata: Record<string, unknown> = { ...existingMeta, ...(input.metadata ?? {}) };
    // Legacy metadata.lmsBatchId mirrors batchId; keep it from resurrecting a removed batch.
    if (input.batchId === null) delete metadata.lmsBatchId;
    else if (input.batchId) metadata.lmsBatchId = input.batchId;
    updateInput.metadata = metadata;

    const updated = await AdmissionRepository.update(ctx.orgId, id, updateInput);

    if (feeRelated) {
      await AdmissionRepository.updateFeeBalance(ctx.orgId, id);
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "admission.updated",
      entityType: "admission",
      entityId: id,
      oldValue: {
        courseName: existing.courseName,
        courseId: existing.courseId,
        batchName: existing.batchName,
        batchId: existing.batchId,
        feePlanId: existing.feePlanId,
        feeAmount: existing.feeAmount,
        feeDiscount: existing.feeDiscount,
        feeFinal: existing.feeFinal,
      },
      newValue: {
        courseName: input.courseName ?? existing.courseName,
        courseId: input.courseId ?? existing.courseId,
        batchName: updateInput.batchName ?? existing.batchName,
        batchId: input.batchId ?? existing.batchId,
        feePlanId: input.feePlanId ?? existing.feePlanId,
        feeAmount: updateInput.feeAmount ?? existing.feeAmount,
        feeDiscount: updateInput.feeDiscount ?? existing.feeDiscount,
        feeFinal: updateInput.feeFinal ?? existing.feeFinal,
        metadataSnapshot: feeRelated,
      },
    });

    return AdmissionRepository.findById(ctx.orgId, id);
  }

  static async changeStage(ctx: RequestContext, id: string, input: ChangeStageInput) {
    const admission = await this.getById(ctx, id);
    const fromStage = admission.stage as AdmissionStage;
    const { toStage } = input;

    // Idempotency — repeating an enrollment request must not create duplicate
    // students, stage logs, or LMS memberships.
    if (fromStage === toStage && toStage === "ENROLLED") {
      return admission;
    }
    if (fromStage === toStage) {
      throw new ValidationError([{ message: `Application is already ${toStage}` }]);
    }

    const allowed = STAGE_TRANSITIONS[fromStage] ?? [];
    if (!allowed.includes(toStage)) {
      throw new ValidationError([
        { message: `Cannot transition from ${fromStage} to ${toStage}. Allowed: ${allowed.join(", ")}` },
      ]);
    }

    let studentId = input.studentId ?? admission.studentId ?? undefined;

    // D-01: never trust a caller-supplied studentId — verify it belongs to this org
    if (studentId) {
      const student = await prisma.student.findFirst({
        where: { id: studentId, orgId: ctx.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!student) throw new NotFoundError("Student", studentId);
    }

    // Phase I — fast-fail capacity BEFORE creating any student, so a blocked
    // enrollment does not orphan a newly created student record. The locked
    // authoritative check still runs inside the enrollment transaction.
    if (toStage === "ENROLLED" && admission.batchId) {
      const batchInfo = await prisma.lmsBatch.findFirst({
        where: { id: admission.batchId, orgId: ctx.orgId },
        select: { capacity: true, id: true },
      });
      if (!batchInfo) throw new NotFoundError("LmsBatch", admission.batchId);
      if (batchInfo.capacity != null) {
        const memberCount = await prisma.lmsBatchStudent.count({
          where: { batchId: admission.batchId },
        });
        if (memberCount + 1 > batchInfo.capacity) {
          throw new ValidationError([
            {
              message: `Batch is at capacity (${batchInfo.capacity} seats). Enrollment blocked.`,
            },
          ]);
        }
      }
    }

    if (toStage === "ENROLLED" && !studentId && input.createStudent === false) {
      throw new ValidationError([
        { message: "Cannot enroll without a linked student. Pass createStudent:true or studentId." },
      ]);
    }

    // ENROLLED is allowed with an outstanding balance (conditional enrollment),
    // but the financial snapshot is recorded explicitly so the dossier can show
    // how the student enrolled and whether they paid in full at that point.
    let enrollmentMetadata: Record<string, unknown> | undefined;
    if (toStage === "ENROLLED") {
      const existingMeta = (admission.metadata ?? {}) as Record<string, unknown>;
      enrollmentMetadata = {
        ...existingMeta,
        enrollment: {
          ...((existingMeta.enrollment ?? {}) as Record<string, unknown>),
          enrolledAt: new Date().toISOString(),
          enrolledBy: ctx.user.id,
          balanceAtEnrollment: Number(admission.feeBalance ?? 0),
          feeFinalAtEnrollment: admission.feeFinal != null ? Number(admission.feeFinal) : null,
          fullPaymentAtEnrollment:
            admission.feeFinal == null ? true : Number(admission.feeBalance ?? 0) <= 0,
        },
      };
    }

    // ENROLLED and DROPPED are the only stage moves that write side-effects
    // (lead, student, LMS batch membership, linked deal). They run in one
    // serialized transaction: the auto-created student shares the commit fate
    // of the batch-capacity check, so a loser never leaves an orphan student.
    if (toStage === "ENROLLED" || toStage === "DROPPED") {
      const wasEnrolledStage = toStage === "ENROLLED";
      const isDrop = toStage === "DROPPED";

      const updated = await prisma.$transaction(async (tx) => {
        // Phase D/E — provision the student from the lead inside the tx. A
        // parallel loss on the batch capacity rollback removes the row again.
        let txStudentId = studentId;
        if (wasEnrolledStage && !txStudentId && admission.lead) {
          txStudentId = await provisionStudentInTx(ctx, tx, admission, input);
        }

        if (wasEnrolledStage && !txStudentId) {
          throw new ValidationError([
            { message: "Cannot enroll without a linked student. Pass createStudent:true or studentId." },
          ]);
        }

        const upd = await tx.admission.update({
          where: { id, orgId: ctx.orgId },
          data: {
            stage: toStage as never,
            stageChangedAt: new Date(),
            stageChangedBy: ctx.user.id,
            ...(txStudentId ? { studentId: txStudentId } : {}),
            ...(wasEnrolledStage && enrollmentMetadata
              ? { metadata: enrollmentMetadata as Prisma.InputJsonValue }
              : {}),
          },
          select: ADMISSION_SELECT,
        });

        await tx.admissionStageLog.create({
          data: {
            orgId: ctx.orgId,
            admissionId: id,
            toStage: toStage as never,
            notes: input.notes,
            changedBy: ctx.user.id,
          },
        });

        if (wasEnrolledStage) {
          await tx.lead.update({
            where: { id: admission.leadId },
            data: { status: "CONVERTED", convertedAt: new Date(), score: 100 },
          });
          await tx.leadActivity.create({
            data: {
              leadId: admission.leadId,
              orgId: ctx.orgId,
              performedBy: ctx.user.id,
              activityType: "STATUS_CHANGE",
              title: "Enrolled — lead converted",
              completedAt: new Date(),
              metadata: { admissionId: id, newStatus: "CONVERTED" },
            },
          });

          if (txStudentId) {
            const updatedCount = await tx.student.updateMany({
              where: { id: txStudentId, orgId: ctx.orgId, deletedAt: null },
              data: { status: "ACTIVE", enrolledAt: new Date() },
            });
            if (updatedCount.count === 0) {
              throw new NotFoundError("Student", txStudentId);
            }
          }

          // Phase H/I — derive batch membership + LMS enrollment from the batch
          // linked on the dossier, enforcing capacity inside a row lock.
          if (txStudentId && admission.batchId) {
            const lock = await tx.$queryRaw<{ id: string }[]>`
              SELECT "id" FROM "lms_batches" WHERE "id" = ${admission.batchId}::uuid FOR UPDATE`;
            if (lock.length === 0) {
              throw new NotFoundError("LmsBatch", admission.batchId);
            }
            const batch = await tx.lmsBatch.findUnique({
              where: { id: admission.batchId },
              select: { capacity: true, courseId: true },
            });
            if (!batch) throw new NotFoundError("LmsBatch", admission.batchId);

            if (batch.capacity != null) {
              const memberCount = await tx.lmsBatchStudent.count({ where: { batchId: admission.batchId } });
              if (memberCount + 1 > batch.capacity) {
                throw new ValidationError([
                  { message: `Batch is at capacity (${batch.capacity} seats). Enrollment blocked.` },
                ]);
              }
            }

            await tx.lmsBatchStudent.upsert({
              where: {
                batchId_studentId: { batchId: admission.batchId, studentId: txStudentId },
              },
              create: { batchId: admission.batchId, studentId: txStudentId },
              update: {},
            });

            await tx.lmsEnrollment.upsert({
              where: { studentId_courseId: { studentId: txStudentId, courseId: batch.courseId } },
              create: {
                orgId: ctx.orgId,
                studentId: txStudentId,
                courseId: batch.courseId,
                batchId: admission.batchId,
                status: "ACTIVE",
              },
              update: { batchId: admission.batchId, status: "ACTIVE" },
            });
          }
        }

        if (isDrop && studentId) {
          await tx.student.updateMany({
            where: { id: studentId, orgId: ctx.orgId, deletedAt: null },
            data: { status: "DROPPED", droppedAt: new Date() },
          });
          await tx.lmsEnrollment.updateMany({
            where: { orgId: ctx.orgId, studentId, status: "ACTIVE" },
            data: { status: "DROPPED" },
          });
        }

        // Phase L — reconcile the linked Deal while it is still open. Terminal
        // (WON/LOST) deals are immutable and are never rewritten backwards.
        if (admission.deal && !["WON", "LOST"].includes(admission.deal.stage)) {
          const deal = admission.deal;
          if (deal.stage !== toStage) {
            const data: Prisma.DealUpdateInput = { stage: toStage as never };
            if (toStage === "ENROLLED") data.wonAt = new Date();
            await tx.deal.update({ where: { id: deal.id }, data });
            void AuditService.write({
              orgId: ctx.orgId,
              userId: ctx.user.id,
              requestId: ctx.requestId,
              ipAddress: ctx.ipAddress,
              action: "deal.stage_reconciled",
              entityType: "deal",
              entityId: deal.id,
              oldValue: { stage: deal.stage },
              newValue: { stage: toStage, viaAdmission: true, admissionId: id },
            });
          }
        }

        return upd;
      });

      // ENROLLED auto-provisioning records the student on the admission row, so
      // the resolved id (whether existing, caller-supplied, or provisioned) is
      // re-read from the tx result for the audit/event trail.
      const resolvedStudentId = updated.studentId ?? studentId;

      await AuditService.write({
        orgId: ctx.orgId,
        userId: ctx.user.id,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        action: "admission.stage_changed",
        entityType: "admission",
        entityId: id,
        oldValue: { stage: fromStage },
        newValue: { stage: toStage, studentId: resolvedStudentId },
      });

      await ActivityFeedService.write({
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        verb: "stage_changed",
        objectType: "admission",
        objectId: id,
        objectSnapshot: { applicationNo: admission.applicationNo },
        context: { from: fromStage, to: toStage, actorName: ctx.user.name },
      });

      await emitEvent({
        name: "admission/stage.changed",
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        requestId: ctx.requestId,
        timestamp: new Date().toISOString(),
        data: {
          admissionId: id,
          applicationNo: admission.applicationNo,
          fromStage,
          toStage,
          studentId: resolvedStudentId,
        },
      });

      // SMS-01: Auto-trigger stage transactional email
      void (async () => {
        try {
          const { StageEmailService } = await import("@/lib/services/stage-email.service");
          await StageEmailService.triggerStageEmail({
            orgId: ctx.orgId,
            stage: toStage,
            leadId: admission.leadId,
            admissionId: id,
            courseName: admission.courseName,
            performedBy: ctx.user?.id,
          });
        } catch (e) {
          console.error("StageEmailService failed:", e);
        }
      })();

      // Task 10: Auto-trigger enrollment confirmation letter email
      if (toStage === "ENROLLED") {
        void (async () => {
          try {
            const adm = await prisma.admission.findUnique({
              where: { id },
              select: {
                applicationNo: true,
                courseName: true,
                batchName: true,
                student: { select: { email: true, firstName: true, lastName: true, studentCode: true } },
                lead: { select: { email: true, name: true } },
              },
            });
            const recipientEmail = adm?.student?.email || adm?.lead?.email;
            const recipientName = adm?.student
              ? `${adm.student.firstName} ${adm.student.lastName}`
              : (adm?.lead?.name || "Student");
            if (recipientEmail) {
              const { getProvider } = await import("@/lib/messaging");
              const provider = getProvider("EMAIL");
              if (provider.isConfigured()) {
                const enrollmentHtml = `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <div style="text-align: center; margin-bottom: 24px;">
                      <h2 style="color: #0f172a; margin: 0;">AIRBORNE AVIATION ACADEMY</h2>
                      <p style="color: #0d9488; margin: 4px 0 0 0; font-size: 14px; font-weight: bold;">Official Enrollment Confirmation Letter</p>
                    </div>
                    <p style="color: #334155; font-size: 15px;">Dear <strong>${recipientName}</strong>,</p>
                    <p style="color: #334155; font-size: 14px; line-height: 1.5;">
                      Congratulations! We are delighted to inform you that your enrollment at Airborne Aviation Academy has been officially confirmed.
                    </p>
                    <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; margin: 20px 0;">
                      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <tr><td style="color: #64748b; padding: 4px 0;">Application No:</td><td style="font-weight: bold; text-align: right;">${adm?.applicationNo}</td></tr>
                        ${adm?.student?.studentCode ? `<tr><td style="color: #64748b; padding: 4px 0;">Cadet Code:</td><td style="font-weight: bold; text-align: right;">${adm.student.studentCode}</td></tr>` : ""}
                        <tr><td style="color: #64748b; padding: 4px 0;">Program:</td><td style="text-align: right;">${adm?.courseName ?? "Flight Cadet Program"}</td></tr>
                        ${adm?.batchName ? `<tr><td style="color: #64748b; padding: 4px 0;">Batch:</td><td style="text-align: right;">${adm.batchName}</td></tr>` : ""}
                        <tr><td style="color: #64748b; padding: 4px 0;">Status:</td><td style="color: #0d9488; font-weight: bold; text-align: right;">ENROLLED</td></tr>
                      </table>
                    </div>
                    <p style="color: #334155; font-size: 14px; line-height: 1.5;">
                      Please keep this confirmation for your records. Our academy admissions and flight operations team will contact you shortly regarding orientation schedules and pre-flight ground briefing.
                    </p>
                    <p style="font-size: 13px; color: #64748b; margin-top: 24px;">Warm regards,<br /><strong>Director of Admissions</strong><br />Airborne Aviation Academy</p>
                  </div>
                `;

                await provider.send({
                  to: recipientEmail,
                  subject: `Official Enrollment Confirmation: ${adm?.applicationNo} — Airborne Aviation Academy`,
                  body: `Congratulations ${recipientName}! Your enrollment with application ${adm?.applicationNo} has been confirmed.`,
                  html: enrollmentHtml,
                });
              }
            }
          } catch (e) {
            console.error("Failed to send automated enrollment email:", e);
          }
        })();
      }

      return updated;
    }

    // Plain transitions — stage + history only (existing behavior).
    const updated = await AdmissionRepository.advanceStage(
      ctx.orgId,
      id,
      toStage,
      ctx.user.id,
      input.notes,
      studentId,
      undefined,
    );

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "admission.stage_changed",
      entityType: "admission",
      entityId: id,
      oldValue: { stage: fromStage },
      newValue: { stage: toStage, studentId },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "stage_changed",
      objectType: "admission",
      objectId: id,
      objectSnapshot: { applicationNo: admission.applicationNo },
      context: { from: fromStage, to: toStage, actorName: ctx.user.name },
    });

    await emitEvent({
      name: "admission/stage.changed",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        admissionId: id,
        applicationNo: admission.applicationNo,
        fromStage,
        toStage,
        studentId,
      },
    });

    return updated;
  }

  static async getStageLogs(ctx: RequestContext, id: string) {
    await this.getById(ctx, id);
    return AdmissionRepository.getStageLogs(ctx.orgId, id);
  }

  static async delete(ctx: RequestContext, id: string) {
    const admission = await prisma.admission.findFirst({
      where: { id, orgId: ctx.orgId },
      select: { id: true, leadId: true, studentId: true, applicationNo: true },
    });
    if (!admission) throw new NotFoundError("Admission", id);

    const { LeadService } = await import("@/lib/services/lead.service");
    await LeadService.delete(ctx, admission.leadId);

    if (admission.studentId) {
      await prisma.student.updateMany({
        where: { id: admission.studentId, orgId: ctx.orgId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "admission.deleted",
      entityType: "admission",
      entityId: id,
      oldValue: { applicationNo: admission.applicationNo, leadId: admission.leadId },
    });

    return { ok: true };
  }
}