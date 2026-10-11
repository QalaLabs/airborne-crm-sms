import { StudentRepository } from "@/lib/repositories/student.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { NotFoundError, ConflictError, ValidationError } from "@/lib/utils/errors";
import { prisma } from "@/lib/db/client";
import type { Prisma, StudentStatus } from "@prisma/client";
import type { CreateStudentInput, UpdateStudentInput, StudentFilters } from "@/lib/validations/student.schema";
import type { RequestContext } from "@/types";

// Phase O — canonical lifecycle. Terminal statuses are never re-entered.
export const STUDENT_STATUS_TRANSITIONS: Record<StudentStatus, StudentStatus[]> = {
  ACTIVE: ["GRADUATED", "DROPPED", "SUSPENDED", "ON_HOLD"],
  ON_HOLD: ["ACTIVE", "DROPPED"],
  SUSPENDED: ["ACTIVE", "DROPPED"],
  GRADUATED: [],
  DROPPED: [],
};

export class StudentService {
  static async list(ctx: RequestContext, filters: StudentFilters) {
    return StudentRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const student = await StudentRepository.findById(ctx.orgId, id);
    if (!student) throw new NotFoundError("Student", id);
    return student;
  }

  static async create(ctx: RequestContext, input: CreateStudentInput) {
    // Email uniqueness within org
    const existing = await StudentRepository.findByEmail(ctx.orgId, input.email);
    if (existing) throw new ConflictError(`Student with email ${input.email} already exists`);

    // If linked to a lead, ensure no student already created from it
    if (input.leadId) {
      const byLead = await StudentRepository.findByLeadId(ctx.orgId, input.leadId);
      if (byLead) throw new ConflictError(`A student (${byLead.studentCode}) already exists for this lead`);

      // Verify lead belongs to this org
      const lead = await prisma.lead.findFirst({
        where: { id: input.leadId, orgId: ctx.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!lead) throw new NotFoundError("Lead", input.leadId);
    }

    // Verify campus belongs to org
    if (input.campusId) {
      const campus = await prisma.campus.findFirst({ where: { id: input.campusId, orgId: ctx.orgId } });
      if (!campus) throw new NotFoundError("Campus", input.campusId);
    }

    const studentCode = await StudentRepository.getNextCode(ctx.orgId);
    const student = await StudentRepository.create(ctx.orgId, { ...input, studentCode });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "student.created",
      entityType: "student",
      entityId: student.id,
      newValue: { studentCode, email: input.email, leadId: input.leadId },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "created",
      objectType: "student",
      objectId: student.id,
      objectSnapshot: { studentCode, name: `${student.firstName} ${student.lastName}` },
      context: { actorName: ctx.user.name },
    });

    return student;
  }

  static async update(ctx: RequestContext, id: string, input: UpdateStudentInput) {
    const existing = await this.getById(ctx, id);

    // Email uniqueness if changing email
    if (input.email && existing.email && input.email.toLowerCase() !== existing.email.toLowerCase()) {
      const conflict = await StudentRepository.findByEmail(ctx.orgId, input.email, id);
      if (conflict) throw new ConflictError(`Student with email ${input.email} already exists`);
    } else if (input.email && !existing.email) {
      const conflict = await StudentRepository.findByEmail(ctx.orgId, input.email, id);
      if (conflict) throw new ConflictError(`Student with email ${input.email} already exists`);
    }

    // Phase O — status transitions are enforced, and lifecycle timestamps are
    // derived server-side (callers cannot set graduatedAt/droppedAt directly).
    let resolvedInput = input;
    if (input.status && input.status !== existing.status) {
      const allowed = STUDENT_STATUS_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(input.status)) {
        throw new ValidationError([
          {
            message: `Cannot transition student from ${existing.status} to ${input.status}. Allowed: ${allowed.join(", ")}`,
          },
        ]);
      }
      const timestamp: Record<string, unknown> = {};
      if (input.status === "ACTIVE") timestamp.enrolledAt = existing.enrolledAt ?? new Date();
      if (input.status === "GRADUATED") timestamp.graduatedAt = new Date();
      if (input.status === "DROPPED") timestamp.droppedAt = new Date();

      const { graduatedAt, droppedAt, enrolledAt, ...rest } = input;
      resolvedInput = { ...rest, status: input.status, ...timestamp };
    }

    const updated = await StudentRepository.update(ctx.orgId, id, resolvedInput);

    // Dropping a student suspends their open LMS enrollments (history kept).
    if (resolvedInput.status === "DROPPED") {
      await prisma.lmsEnrollment.updateMany({
        where: { orgId: ctx.orgId, studentId: id, status: "ACTIVE" },
        data: { status: "DROPPED" as never },
      });
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "student.updated",
      entityType: "student",
      entityId: id,
      oldValue: {
        firstName: existing.firstName,
        lastName: existing.lastName,
        email: existing.email,
        status: existing.status,
      },
      newValue: {
        firstName: resolvedInput.firstName ?? existing.firstName,
        lastName: resolvedInput.lastName ?? existing.lastName,
        email: resolvedInput.email ?? existing.email,
        status: resolvedInput.status ?? existing.status,
      },
    });

    return updated;
  }

  static async delete(ctx: RequestContext, id: string) {
    await this.getById(ctx, id);
    await StudentRepository.softDelete(ctx.orgId, id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "student.deleted",
      entityType: "student",
      entityId: id,
    });

    return { ok: true };
  }

  static async getAdmissions(ctx: RequestContext, studentId: string) {
    await this.getById(ctx, studentId);
    return prisma.admission.findMany({
      where: { studentId, orgId: ctx.orgId },
      orderBy: { createdAt: "desc" },
      include: {
        campus: { select: { id: true, name: true, code: true } },
        counselor: { select: { id: true, name: true } },
        _count: { select: { documents: true, payments: true } },
      },
    });
  }
}
