import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type { PaymentFilters, CreatePaymentInput, UpdatePaymentInput } from "@/lib/validations/payment.schema";
import {
  formatReceiptNo,
  computeNetPaid,
  NET_CONTRIBUTING_STATUSES,
  type PaymentCashflow,
} from "@/lib/services/fee-calculation.service";

type Db = Pick<typeof prisma, "paymentTransaction" | "$queryRaw">;

const PAYMENT_SELECT = {
  id: true,
  orgId: true,
  campusId: true,
  admissionId: true,
  studentId: true,
  amount: true,
  currency: true,
  method: true,
  status: true,
  referenceNo: true,
  receiptNo: true,
  feeType: true,
  description: true,
  paidAt: true,
  gateway: true,
  gatewayTxnId: true,
  notes: true,
  collectedBy: true,
  idempotencyKey: true,
  refundedAmount: true,
  refundedAt: true,
  refundedBy: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  admission: { select: { id: true, applicationNo: true, stage: true } },
  student: { select: { id: true, studentCode: true, firstName: true, lastName: true } },
  collector: { select: { id: true, name: true } },
  refunder: { select: { id: true, name: true } },
} satisfies Prisma.PaymentTransactionSelect;

/** A counselor owns a payment when they are the admission counselor or the lead assignee. */
export function paymentCounselorWhere(userId: string): Prisma.PaymentTransactionWhereInput {
  return { admission: { OR: [{ counselorId: userId }, { lead: { assignedTo: userId } }] } };
}

export class PaymentRepository {
  static async findMany(orgId: string, filters: PaymentFilters, db: Db = prisma, assignedTo?: string) {
    const where: Prisma.PaymentTransactionWhereInput = {
      orgId,
      ...(assignedTo !== undefined && paymentCounselorWhere(assignedTo)),
      ...(filters.status && { status: filters.status }),
      ...(filters.method && { method: filters.method }),
      ...(filters.feeType && { feeType: filters.feeType }),
      ...(filters.admissionId && { admissionId: filters.admissionId }),
      ...(filters.studentId && { studentId: filters.studentId }),
      ...(filters.campusId && { campusId: filters.campusId }),
      ...(filters.search && {
        OR: [
          { receiptNo: { contains: filters.search, mode: "insensitive" } },
          { referenceNo: { contains: filters.search, mode: "insensitive" } },
          { admission: { applicationNo: { contains: filters.search, mode: "insensitive" } } },
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
      db.paymentTransaction.findMany({
        where,
        select: PAYMENT_SELECT,
        skip,
        take: filters.limit,
        orderBy: { [filters.sortBy]: filters.sortDir },
      }),
      db.paymentTransaction.count({ where }),
    ]);
    return { data, total };
  }

  static async findById(orgId: string, id: string, assignedTo?: string) {
    return prisma.paymentTransaction.findFirst({
      where: { id, orgId, ...(assignedTo !== undefined && paymentCounselorWhere(assignedTo)) },
      select: PAYMENT_SELECT,
    });
  }

  static async findByIdempotencyKey(orgId: string, idempotencyKey: string) {
    return prisma.paymentTransaction.findFirst({
      where: { orgId, idempotencyKey },
      select: PAYMENT_SELECT,
    });
  }

  /**
   * Allocate the next receipt number from the payment_receipt_seq sequence.
   * Unique across the system; formatted RCP-YYYYMM-xxxxx so each org's receipt
   * numbers are unique and monotonic without a per-org counter or row locks.
   */
  static async getNextReceiptNo(_orgId: string, db: Db = prisma): Promise<string> {
    const rows = await db.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('payment_receipt_seq'::regclass) AS nextval
    `;
    const seq = rows[0]?.nextval;
    if (seq === undefined) {
      throw new Error("payment_receipt_seq query returned no row");
    }
    return formatReceiptNo(Number(seq));
  }

  static async create(
    orgId: string,
    admissionId: string,
    collectedBy: string,
    data: CreatePaymentInput & {
      receiptNo: string;
      studentId?: string;
      campusId?: string;
      idempotencyKey?: string;
    },
    db: Db = prisma,
  ) {
    return db.paymentTransaction.create({
      data: {
        orgId,
        admissionId,
        studentId: data.studentId,
        campusId: data.campusId,
        collectedBy,
        receiptNo: data.receiptNo,
        amount: data.amount,
        currency: data.currency,
        method: data.method,
        feeType: data.feeType,
        description: data.description,
        referenceNo: data.referenceNo,
        paidAt: data.paidAt ? new Date(data.paidAt) : new Date(),
        status: "COMPLETED",
        notes: data.notes,
        idempotencyKey: data.idempotencyKey,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: PAYMENT_SELECT,
    });
  }

  static async update(
    orgId: string,
    id: string,
    data: UpdatePaymentInput,
    db: Db = prisma,
  ) {
    return db.paymentTransaction.update({
      where: { id, orgId },
      data: {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.referenceNo !== undefined && { referenceNo: data.referenceNo }),
        ...(data.paidAt !== undefined && { paidAt: data.paidAt ? new Date(data.paidAt) : null }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.gatewayTxnId !== undefined && { gatewayTxnId: data.gatewayTxnId }),
        ...(data.metadata !== undefined && { metadata: data.metadata as Prisma.InputJsonValue }),
      },
      select: PAYMENT_SELECT,
    });
  }

  /** Apply a refund atomically, preserving the refund accounting trail. */
  static async applyRefund(
    orgId: string,
    id: string,
    refund: {
      refundedAmount: number;
      refundedAt: Date;
      refundedBy: string;
      status: "REFUNDED" | "PARTIALLY_REFUNDED";
    },
    db: Db = prisma,
  ) {
    return db.paymentTransaction.update({
      where: { id, orgId },
      data: {
        refundedAmount: refund.refundedAmount,
        refundedAt: refund.refundedAt,
        refundedBy: refund.refundedBy,
        status: refund.status,
      },
      select: PAYMENT_SELECT,
    });
  }

  static async getTotalByAdmission(orgId: string, admissionId: string, db: Db = prisma) {
    const rows = await db.paymentTransaction.findMany({
      where: { admissionId, orgId },
      select: { amount: true, refundedAmount: true, status: true },
    });
    const cashflow: PaymentCashflow[] = rows.map((r) => ({
      amount: Number(r.amount),
      refundedAmount: Number(r.refundedAmount ?? 0),
      status: r.status,
    }));
    return {
      total: computeNetPaid(cashflow),
      count: rows.filter((r) => NET_CONTRIBUTING_STATUSES.has(r.status)).length,
    };
  }
}