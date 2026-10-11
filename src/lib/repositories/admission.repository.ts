import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type { AdmissionFilters, CreateAdmissionInput, UpdateAdmissionInput } from "@/lib/validations/admission.schema";
import { reconcileDerivedFields } from "@/lib/services/fee-calculation.service";

type FeeLedgerDb = Pick<typeof prisma, "paymentTransaction" | "admission">;

export const ADMISSION_SELECT = {
  id: true,
  orgId: true,
  campusId: true,
  studentId: true,
  leadId: true,
  applicationNo: true,
  stage: true,
  courseName: true,
  courseId: true,
  batchName: true,
  batchStartDate: true,
  batchId: true,
  feePlanId: true,
  feeAmount: true,
  feeDiscount: true,
  feeFinal: true,
  feePaid: true,
  feeBalance: true,
  counselorId: true,
  stageChangedAt: true,
  stageChangedBy: true,
  notes: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  campus: { select: { id: true, name: true, code: true } },
  student: { select: { id: true, studentCode: true, firstName: true, lastName: true } },
  lead: { select: { id: true, name: true, phone: true, email: true } },
  counselor: { select: { id: true, name: true, email: true, avatarUrl: true } },
  course: { select: { id: true, title: true, slug: true, fee: true } },
  batch: {
    select: {
      id: true,
      name: true,
      type: true,
      startDate: true,
      endDate: true,
      capacity: true,
      course: { select: { id: true, title: true } },
    },
  },
  deal: { select: { id: true, title: true, stage: true, value: true, currency: true, wonAt: true, lostAt: true, revertedAt: true } },
  feePlan: {
    select: {
      id: true,
      name: true,
      currency: true,
      items: {
        orderBy: { sortOrder: "asc" as const },
        select: { id: true, name: true, amount: true, percentOfFee: true, dueOffsetDays: true, sortOrder: true },
      },
    },
  },
  _count: { select: { documents: true, payments: true, stageLogs: true } },
} satisfies Prisma.AdmissionSelect;

/** Detail fetch — includes related collections for the admissions dossier UI. */
const ADMISSION_DETAIL_SELECT = {
  ...ADMISSION_SELECT,
  stageLogs: {
    orderBy: { changedAt: "desc" as const },
    take: 50,
    include: { actor: { select: { id: true, name: true, avatarUrl: true } } },
  },
  documents: {
    orderBy: { createdAt: "desc" as const },
    take: 50,
    select: {
      id: true,
      documentType: true,
      name: true,
      fileUrl: true,
      fileMimeType: true,
      fileSizeBytes: true,
      status: true,
      rejectionReason: true,
      reviewedAt: true,
      createdAt: true,
    },
  },
  payments: {
    orderBy: { createdAt: "desc" as const },
    take: 50,
    select: {
      id: true,
      amount: true,
      currency: true,
      method: true,
      status: true,
      receiptNo: true,
      feeType: true,
      referenceNo: true,
      refundedAmount: true,
      refundedAt: true,
      paidAt: true,
      createdAt: true,
    },
  },
} satisfies Prisma.AdmissionSelect;

export class AdmissionRepository {
  static async findMany(orgId: string, filters: AdmissionFilters) {
    const where: Prisma.AdmissionWhereInput = {
      orgId,
      ...(filters.stage && { stage: filters.stage }),
      ...(filters.campusId && { campusId: filters.campusId }),
      ...(filters.counselorId && { counselorId: filters.counselorId }),
      ...(filters.studentId && { studentId: filters.studentId }),
      ...(filters.leadId && { leadId: filters.leadId }),
      ...(filters.search && {
        OR: [
          { applicationNo: { contains: filters.search, mode: "insensitive" } },
          { lead: { name: { contains: filters.search, mode: "insensitive" } } },
          { student: { firstName: { contains: filters.search, mode: "insensitive" } } },
          { student: { lastName: { contains: filters.search, mode: "insensitive" } } },
        ],
      }),
      ...(filters.dateFrom || filters.dateTo
        ? {
            createdAt: {
              ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
              ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
            },
          }
        : {}),
    };

    const skip = (filters.page - 1) * filters.limit;
    const [data, total] = await Promise.all([
      prisma.admission.findMany({
        where,
        select: ADMISSION_SELECT,
        skip,
        take: filters.limit,
        orderBy: { [filters.sortBy]: filters.sortDir },
      }),
      prisma.admission.count({ where }),
    ]);
    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.admission.findFirst({
      where: { id, orgId },
      select: ADMISSION_DETAIL_SELECT,
    });
  }

  static async getNextApplicationNo(orgId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await prisma.admission.count({ where: { orgId } });
    const seq = String(count + 1).padStart(5, "0");
    return `APP-${year}-${seq}`;
  }

  static async create(
    orgId: string,
    data: CreateAdmissionInput & { applicationNo: string; feeFinal?: number | null },
  ) {
    // feeFinal is always computed server-side: an explicit override (used by the
    // service when a fee plan resolves percent items) wins over feeAmount − discount.
    const feeFinal =
      data.feeFinal !== undefined
        ? data.feeFinal
        : data.feeAmount != null
          ? data.feeAmount - (data.feeDiscount ?? 0)
          : null;

    return prisma.admission.create({
      data: {
        orgId,
        leadId: data.leadId,
        campusId: data.campusId,
        counselorId: data.counselorId,
        applicationNo: data.applicationNo,
        courseName: data.courseName,
        courseId: data.courseId,
        batchName: data.batchName,
        batchStartDate: data.batchStartDate ? new Date(data.batchStartDate) : null,
        batchId: data.batchId,
        feePlanId: data.feePlanId,
        feeAmount: data.feeAmount,
        feeDiscount: data.feeDiscount,
        feeFinal,
        feeBalance: feeFinal ?? 0,
        notes: data.notes,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: ADMISSION_SELECT,
    });
  }

  static async update(
    orgId: string,
    id: string,
    data: Omit<UpdateAdmissionInput, "batchName"> & { feeFinal?: number | null; batchName?: string | null },
  ) {
    const existing = await prisma.admission.findFirst({
      where: { id, orgId },
      select: { feeAmount: true, feeDiscount: true },
    });

    // Recompute feeFinal whenever feeAmount or feeDiscount changes (Phase G):
    // use the incoming value when supplied, otherwise the current stored value.
    let feeFinalUpdate: number | null | undefined;
    if (data.feeFinal !== undefined) {
      feeFinalUpdate = data.feeFinal;
    } else if (data.feeAmount !== undefined || data.feeDiscount !== undefined) {
      const amount = data.feeAmount !== undefined ? data.feeAmount : existing?.feeAmount;
      const discount = data.feeDiscount !== undefined ? data.feeDiscount : existing?.feeDiscount ?? 0;
      feeFinalUpdate =
        amount != null ? Math.round((Number(amount) - Number(discount)) * 100) / 100 : null;
    }

    return prisma.admission.update({
      where: { id, orgId },
      data: {
        ...(data.campusId !== undefined && { campusId: data.campusId }),
        ...(data.counselorId !== undefined && { counselorId: data.counselorId }),
        ...(data.studentId !== undefined && { studentId: data.studentId }),
        ...(data.courseName !== undefined && { courseName: data.courseName }),
        ...(data.courseId !== undefined && { courseId: data.courseId }),
        ...(data.batchName !== undefined && { batchName: data.batchName }),
        ...(data.batchStartDate !== undefined && { batchStartDate: data.batchStartDate ? new Date(data.batchStartDate) : null }),
        ...(data.batchId !== undefined && { batchId: data.batchId }),
        ...(data.feePlanId !== undefined && { feePlanId: data.feePlanId }),
        ...(data.feeAmount !== undefined && { feeAmount: data.feeAmount }),
        ...(data.feeDiscount !== undefined && { feeDiscount: data.feeDiscount }),
        // feePaid/feeBalance are intentionally NOT touched here — they are
        // recomputed from the payment cashflow by the caller's reconcile step.
        ...(feeFinalUpdate !== undefined && { feeFinal: feeFinalUpdate }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.metadata !== undefined && { metadata: data.metadata as Prisma.InputJsonValue }),
      },
      select: ADMISSION_SELECT,
    });
  }

  static async advanceStage(
    orgId: string,
    id: string,
    toStage: string,
    changedBy: string,
    notes?: string,
    studentId?: string,
    metadataOverride?: Record<string, unknown>,
  ) {
    const [admission] = await prisma.$transaction([
      prisma.admission.update({
        where: { id, orgId },
        data: {
          stage: toStage as never,
          stageChangedAt: new Date(),
          stageChangedBy: changedBy,
          ...(studentId && { studentId }),
          ...(toStage === "ENROLLED" && { studentId }),
          ...(toStage === "ENROLLED" && metadataOverride
            ? { metadata: metadataOverride as Prisma.InputJsonValue }
            : {}),
        },
        select: ADMISSION_SELECT,
      }),
      prisma.admissionStageLog.create({
        data: {
          orgId,
          admissionId: id,
          toStage: toStage as never,
          notes,
          changedBy,
        },
      }),
    ]);
    return admission;
  }

  static async getStageLogs(orgId: string, admissionId: string) {
    return prisma.admissionStageLog.findMany({
      where: { admissionId, orgId },
      orderBy: { changedAt: "desc" },
      include: { actor: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  /**
   * Recompute a cached (feePaid, feeBalance) from the live payment cashflow via
   * the authoritative calculation module. feeBalance is unclamped — an
   * overpayment shows as a credit (negative balance). Accepts a transaction
   * client so callers can reconcile inside an atomic write.
   */
  static async updateFeeBalance(orgId: string, id: string, db: FeeLedgerDb = prisma) {
    const [payments, admission] = await Promise.all([
      db.paymentTransaction.findMany({
        where: { admissionId: id, orgId },
        select: { amount: true, refundedAmount: true, status: true },
      }),
      db.admission.findFirst({
        where: { id, orgId },
        select: { feeFinal: true },
      }),
    ]);

    const { feePaid, feeBalance } = reconcileDerivedFields(
      payments.map((p) => ({
        amount: Number(p.amount),
        refundedAmount: Number(p.refundedAmount ?? 0),
        status: p.status,
      })),
      admission?.feeFinal != null ? Number(admission.feeFinal) : null,
    );

    return db.admission.update({
      where: { id, orgId },
      data: { feePaid, feeBalance },
      select: { id: true, feePaid: true, feeBalance: true },
    });
  }
}
