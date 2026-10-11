import { prisma } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit.service";
import { AppError, NotFoundError } from "@/lib/utils/errors";
import {
  readApprovedCopy,
  renderLetterHtml,
  UnresolvedPlaceholderError,
  type FeeSnapshotItem,
  type LetterKind,
} from "@/lib/admissions/letters";
import type { RequestContext } from "@/types";

interface StoredFeePlanSnapshot {
  name?: string;
  currency?: string;
  appliedAt?: string;
  items?: FeeSnapshotItem[];
}

export class AdmissionLetterService {
  static async render(ctx: RequestContext, admissionId: string, kind: LetterKind, now = new Date()) {
    const admission = await prisma.admission.findFirst({
      where: { id: admissionId, orgId: ctx.orgId },
      include: {
        org: { select: { name: true, logoUrl: true, settings: true } },
        lead: { select: { name: true, email: true, phone: true } },
        student: { select: { firstName: true, lastName: true, email: true, phone: true, studentCode: true } },
        course: { select: { title: true } },
        batch: { select: { name: true, startDate: true } },
        campus: { select: { name: true } },
        counselor: { select: { name: true } },
      },
    });
    if (!admission) throw new NotFoundError("Admission", admissionId);

    const meta = (admission.metadata ?? {}) as { feePlanSnapshot?: StoredFeePlanSnapshot };
    const snapshot = meta.feePlanSnapshot;
    const applicantName = admission.student
      ? `${admission.student.firstName} ${admission.student.lastName}`.trim()
      : admission.lead.name;

    let rendered: { html: string; approved: boolean };
    try {
      rendered = renderLetterHtml(kind, {
        org: { name: admission.org.name, logoUrl: admission.org.logoUrl },
        applicationNo: admission.applicationNo,
        applicantName,
        applicantEmail: admission.student?.email ?? admission.lead.email,
        applicantPhone: admission.student?.phone ?? admission.lead.phone,
        studentCode: admission.student?.studentCode ?? null,
        courseName: admission.course?.title ?? admission.courseName,
        batchName: admission.batch?.name ?? admission.batchName,
        batchStartDate: admission.batch?.startDate ?? admission.batchStartDate,
        campusName: admission.campus?.name ?? null,
        counselorName: admission.counselor?.name ?? null,
        feeAmount: admission.feeAmount?.toString() ?? null,
        feeDiscount: admission.feeDiscount.toString(),
        feeFinal: admission.feeFinal?.toString() ?? null,
        feePaid: admission.feePaid.toString(),
        feeBalance: admission.feeBalance.toString(),
        feePlan: snapshot?.items?.length
          ? { name: snapshot.name ?? null, currency: snapshot.currency ?? null, appliedAt: snapshot.appliedAt ?? null, items: snapshot.items }
          : null,
        issuedAt: now,
        approvedCopy: readApprovedCopy(admission.org.settings, kind),
      });
    } catch (err) {
      if (err instanceof UnresolvedPlaceholderError) {
        throw new AppError("LETTER_TEMPLATE_INVALID", err.message, 422, err.tokens);
      }
      throw err;
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: kind === "offer" ? "admission.offer_letter_generated" : "admission.fee_update_generated",
      entityType: "admission",
      entityId: admission.id,
      newValue: { applicationNo: admission.applicationNo, approvedCopy: rendered.approved },
    });

    return rendered;
  }
}
