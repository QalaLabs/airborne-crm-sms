import { PaymentRepository } from "@/lib/repositories/payment.repository";
import { AdmissionRepository } from "@/lib/repositories/admission.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { emitEvent } from "@/lib/events/inngest";
import { prisma } from "@/lib/db/client";
import {
  deriveIdempotencyKey,
  paymentAmountError,
  reconcileDerivedFields,
  roundMoney,
  type PaymentCashflow,
} from "@/lib/services/fee-calculation.service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/utils/errors";
import type { CreatePaymentInput, UpdatePaymentInput, RefundPaymentInput, PaymentFilters } from "@/lib/validations/payment.schema";
import type { PaymentStatus } from "@prisma/client";
import type { RequestContext } from "@/types";

function isPrismaP2002(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

function toCashflow(payments: {
  amount: unknown;
  refundedAmount: unknown;
  status: string;
}[]): PaymentCashflow[] {
  return payments.map((p) => ({
    amount: Number(p.amount),
    refundedAmount: Number(p.refundedAmount ?? 0),
    status: p.status,
  }));
}

export class PaymentService {
  /** Counselors only see payments on admissions whose lead is assigned to them. */
  static counselorScope(ctx: RequestContext): string | undefined {
    return ctx.user.role === "ADMISSIONS_COUNSELOR" ? ctx.user.id : undefined;
  }

  static async list(ctx: RequestContext, filters: PaymentFilters) {
    return PaymentRepository.findMany(ctx.orgId, filters, undefined, this.counselorScope(ctx));
  }

  static async getById(ctx: RequestContext, id: string) {
    const payment = await PaymentRepository.findById(ctx.orgId, id, this.counselorScope(ctx));
    if (!payment) throw new NotFoundError("Payment", id);
    return payment;
  }

  /**
   * Record a manual payment atomically:
   *   - locks the admission row (FOR UPDATE) so concurrent payments cannot race
   *     the outstanding-balance check,
   *   - dedupes via idempotencyKey (client-supplied or derived from the
   *     reference number), returning the original receipt on replay,
   *   - allocates a sequence-backed receipt number,
   *   - rejects ONLINE (no gateway) and overpayments,
   *   - reconciles feePaid/feeBalance and writes the audit trail in the same
   *     transaction; activity + automation events fire only after commit.
   */
  static async create(ctx: RequestContext, admissionId: string, input: CreatePaymentInput) {
    const idempotencyKey =
      input.idempotencyKey ??
      deriveIdempotencyKey({ referenceNo: input.referenceNo, amount: input.amount, method: input.method });

    try {
      const { payment, created } = await prisma.$transaction(async (tx) => {
        // Serialize payments for this admission; blocks until a concurrent
        // payment's transaction (which updates feePaid/feeBalance) commits.
        const [locked] = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "admissions" WHERE "id" = ${admissionId}::uuid AND "orgId" = ${ctx.orgId}::uuid FOR UPDATE
        `;
        if (!locked) throw new NotFoundError("Admission", admissionId);

        if (String(input.method) === "ONLINE") {
          throw new ValidationError([
            { message: "ONLINE payments require a payment gateway which is not configured on this account" },
          ]);
        }

        if (idempotencyKey) {
          const existing = await tx.paymentTransaction.findFirst({
            where: { orgId: ctx.orgId, idempotencyKey },
            select: { id: true, receiptNo: true },
          });
          if (existing) {
            const payment = await PaymentRepository.findById(ctx.orgId, existing.id);
            if (payment) return { payment, created: false };
          }
        }

        // Authoritative balance from the live cashflow (unclamped — credits shown negative).
        const admission = await tx.admission.findFirst({
          where: { id: admissionId, orgId: ctx.orgId },
          select: { id: true, feeFinal: true, studentId: true, campusId: true },
        });
        if (!admission) throw new NotFoundError("Admission", admissionId);

        const cashflow = toCashflow(
          await tx.paymentTransaction.findMany({
            where: { admissionId, orgId: ctx.orgId },
            select: { amount: true, refundedAmount: true, status: true },
          }),
        );
        const { feeBalance } = reconcileDerivedFields(
          cashflow,
          admission.feeFinal != null ? Number(admission.feeFinal) : null,
        );

        const amountError = paymentAmountError(input.amount, feeBalance);
        if (amountError) {
          throw new ValidationError([{ message: amountError }]);
        }

        const receiptNo = await PaymentRepository.getNextReceiptNo(ctx.orgId, tx);
        const payment = await PaymentRepository.create(
          ctx.orgId,
          admissionId,
          ctx.user.id,
          {
            ...input,
            receiptNo,
            studentId: admission.studentId ?? undefined,
            campusId: admission.campusId ?? undefined,
            idempotencyKey: idempotencyKey ?? undefined,
          },
          tx,
        );

        await AdmissionRepository.updateFeeBalance(ctx.orgId, admissionId, tx);

        await AuditService.write(
          {
            orgId: ctx.orgId,
            userId: ctx.user.id,
            requestId: ctx.requestId,
            ipAddress: ctx.ipAddress,
            action: "payment.recorded",
            entityType: "payment",
            entityId: payment.id,
            newValue: {
              amount: input.amount,
              method: input.method,
              feeType: input.feeType,
              receiptNo,
              referenceNo: input.referenceNo,
              admissionId,
              idempotencyKey,
            },
          },
          tx,
        );

        return { payment, created: true };
      });

      if (created) {
        await ActivityFeedService.write({
          orgId: ctx.orgId,
          actorId: ctx.user.id,
          verb: "recorded_payment",
          objectType: "payment",
          objectId: payment.id,
          objectSnapshot: { amount: input.amount, method: input.method, receiptNo: payment.receiptNo },
          targetType: "admission",
          targetId: admissionId,
          context: { actorName: ctx.user.name },
        });

        await emitEvent({
          name: "payment/received",
          orgId: ctx.orgId,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          requestId: ctx.requestId,
          timestamp: new Date().toISOString(),
          data: {
            paymentId: payment.id,
            admissionId,
            studentId: payment.studentId ?? undefined,
            amount: String(input.amount),
            method: input.method,
            receiptNo: payment.receiptNo ?? undefined,
          },
        });

        // Task 10: Auto-trigger email with styled HTML invoice receipt on payment creation
        void (async () => {
          try {
            const adm = await prisma.admission.findUnique({
              where: { id: admissionId },
              select: {
                applicationNo: true,
                courseName: true,
                feeFinal: true,
                feeBalance: true,
                student: { select: { email: true, firstName: true, lastName: true } },
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
                const receiptHtml = `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <div style="text-align: center; margin-bottom: 24px;">
                      <h2 style="color: #0f172a; margin: 0;">AIRBORNE AVIATION ACADEMY</h2>
                      <p style="color: #64748b; margin: 4px 0 0 0; font-size: 14px;">Official Payment Receipt</p>
                    </div>
                    <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; margin-bottom: 20px;">
                      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <tr><td style="color: #64748b; padding: 4px 0;">Receipt No:</td><td style="font-weight: bold; text-align: right;">${payment.receiptNo}</td></tr>
                        <tr><td style="color: #64748b; padding: 4px 0;">Application No:</td><td style="text-align: right;">${adm?.applicationNo ?? "—"}</td></tr>
                        <tr><td style="color: #64748b; padding: 4px 0;">Candidate:</td><td style="text-align: right;">${recipientName}</td></tr>
                        <tr><td style="color: #64748b; padding: 4px 0;">Program:</td><td style="text-align: right;">${adm?.courseName ?? "Aviation Training"}</td></tr>
                        <tr><td style="color: #64748b; padding: 4px 0;">Payment Method:</td><td style="text-align: right;">${input.method}</td></tr>
                        ${input.referenceNo ? `<tr><td style="color: #64748b; padding: 4px 0;">Transaction Ref:</td><td style="text-align: right;">${input.referenceNo}</td></tr>` : ""}
                        <tr><td style="color: #64748b; padding: 8px 0 4px 0; border-top: 1px solid #e2e8f0; font-weight: bold;">Amount Paid:</td><td style="border-top: 1px solid #e2e8f0; font-weight: bold; color: #16a34a; font-size: 16px; text-align: right;">₹${Number(input.amount).toLocaleString("en-IN")}</td></tr>
                        ${adm?.feeBalance != null ? `<tr><td style="color: #64748b; padding: 4px 0;">Remaining Balance:</td><td style="font-weight: bold; color: #d97706; text-align: right;">₹${Number(adm.feeBalance).toLocaleString("en-IN")}</td></tr>` : ""}
                      </table>
                    </div>
                    <p style="font-size: 13px; color: #64748b; text-align: center; margin: 0;">
                      Thank you for your payment. For fee queries, contact Airborne Accounts.
                    </p>
                  </div>
                `;

                await provider.send({
                  to: recipientEmail,
                  subject: `Payment Receipt: ${payment.receiptNo} — Airborne Aviation Academy`,
                  body: `Receipt No: ${payment.receiptNo}\nAmount Paid: ₹${Number(input.amount).toLocaleString("en-IN")}\nApplication: ${adm?.applicationNo ?? "—"}`,
                  html: receiptHtml,
                });
              }
            }
          } catch (e) {
            console.error("Failed to send automated payment receipt email:", e);
          }
        })();
      }

      return payment;
    } catch (err) {
      // A concurrent request with the same idempotency key lost the insert race:
      // the winner is the source of truth — replay it instead of failing.
      if (isPrismaP2002(err) && idempotencyKey) {
        const existing = await PaymentRepository.findByIdempotencyKey(ctx.orgId, idempotencyKey);
        if (existing) return existing;
      }
      throw err;
    }
  }

  static async update(ctx: RequestContext, id: string, input: UpdatePaymentInput) {
    if (String(input.status) === "REFUNDED" || String(input.status) === "PARTIALLY_REFUNDED") {
      throw new ValidationError([
        { message: "Refund statuses must be set through the refund endpoint" },
      ]);
    }
    const status = input.status as PaymentStatus | undefined;

    const existing = await this.getById(ctx, id);

    const updated = await prisma.$transaction(async (tx) => {
      const payment = await PaymentRepository.update(ctx.orgId, id, input, tx);

      // Any transition (into or out of COMPLETED, into PENDING/FAILED) changes
      // the net contribution, so always re-derive the admission's cached fields.
      if (status && status !== existing.status) {
        await AdmissionRepository.updateFeeBalance(ctx.orgId, existing.admissionId, tx);
      }

      await AuditService.write(
        {
          orgId: ctx.orgId,
          userId: ctx.user.id,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          action: "payment.updated",
          entityType: "payment",
          entityId: id,
          oldValue: { status: existing.status, refundedAmount: existing.refundedAmount ?? 0 },
          newValue: { status: status ?? existing.status, referenceNo: input.referenceNo },
        },
        tx,
      );

      return payment;
    });

    return updated;
  }

  /**
   * Permanently remove a ledger entry (SUPER_ADMIN only). The admission's
   * feePaid/feeBalance are re-derived in the same transaction and the full
   * row is kept in the audit log.
   */
  static async remove(ctx: RequestContext, id: string) {
    if (ctx.user.role !== "SUPER_ADMIN") {
      throw new ForbiddenError("delete", "payment ledger entries");
    }

    const deleted = await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "payment_transactions"
        WHERE "id" = ${id}::uuid AND "orgId" = ${ctx.orgId}::uuid
        FOR UPDATE
      `;
      if (!locked) throw new NotFoundError("Payment", id);

      const row = await tx.paymentTransaction.findFirst({ where: { id, orgId: ctx.orgId } });
      if (!row) throw new NotFoundError("Payment", id);

      await tx.paymentTransaction.delete({ where: { id } });
      await AdmissionRepository.updateFeeBalance(ctx.orgId, row.admissionId, tx);

      await AuditService.write(
        {
          orgId: ctx.orgId,
          userId: ctx.user.id,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          action: "payment.deleted",
          entityType: "payment",
          entityId: id,
          oldValue: {
            admissionId: row.admissionId,
            studentId: row.studentId,
            amount: String(row.amount),
            refundedAmount: String(row.refundedAmount),
            method: row.method,
            status: row.status,
            receiptNo: row.receiptNo,
            referenceNo: row.referenceNo,
            feeType: row.feeType,
            paidAt: row.paidAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
          },
        },
        tx,
      );

      return row;
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "deleted_payment",
      objectType: "payment",
      objectId: id,
      objectSnapshot: { amount: String(deleted.amount), receiptNo: deleted.receiptNo },
      targetType: "admission",
      targetId: deleted.admissionId,
      context: { actorName: ctx.user.name },
    });

    return { id, admissionId: deleted.admissionId };
  }

  /** Refund all or part of a payment. Full refund → REFUNDED, else PARTIALLY_REFUNDED. */
  static async refund(ctx: RequestContext, id: string, input: RefundPaymentInput) {
    const existing = await this.getById(ctx, id);

    if (existing.status === "REFUNDED") {
      throw new ValidationError([{ message: "This payment is already fully refunded" }]);
    }
    if (existing.status === "PENDING" || existing.status === "FAILED") {
      throw new ValidationError([
        { message: `Cannot refund a ${existing.status} payment` },
      ]);
    }

    const refundedSoFar = Number(existing.refundedAmount ?? 0);
    const grossAmount = Number(existing.amount);
    const remaining = roundMoney(Math.max(0, grossAmount - refundedSoFar));
    if (input.amount > remaining + 1e-6) {
      throw new ValidationError([
        { message: `Refund of ₹${input.amount.toLocaleString("en-IN")} exceeds the remaining refundable amount of ₹${remaining.toLocaleString("en-IN")}` },
      ]);
    }

    const payment = await prisma.$transaction(async (tx) => {
      // M-01: lock the row inside the transaction to prevent concurrent refund races.
      const [locked] = await tx.$queryRaw<{ status: string; refundedAmount: string }[]>`
        SELECT "status", "refundedAmount"
        FROM "payment_transactions"
        WHERE "id" = ${id}::uuid AND "orgId" = ${ctx.orgId}::uuid
        FOR UPDATE
      `;
      if (!locked) {
        throw new NotFoundError("Payment", id);
      }
      const freshRefundedAmount = Number(locked.refundedAmount ?? 0);
      const freshStatus = locked.status;
      if (freshStatus === "REFUNDED") {
        throw new ValidationError([{ message: "This payment is already fully refunded" }]);
      }
      if (freshStatus === "PENDING" || freshStatus === "FAILED") {
        throw new ValidationError([
          { message: `Cannot refund a ${freshStatus} payment` },
        ]);
      }
      const freshRemaining = roundMoney(Math.max(0, grossAmount - freshRefundedAmount));
      if (input.amount > freshRemaining + 1e-6) {
        throw new ValidationError([
          { message: `Refund of ₹${input.amount.toLocaleString("en-IN")} exceeds the remaining refundable amount of ₹${freshRemaining.toLocaleString("en-IN")}` },
        ]);
      }

      const refundedAmount = roundMoney(freshRefundedAmount + input.amount);
      const finalStatus = refundedAmount >= grossAmount ? "REFUNDED" : "PARTIALLY_REFUNDED";
      const refundedAt = new Date();

      const updated = await PaymentRepository.applyRefund(
        ctx.orgId,
        id,
        { refundedAmount, refundedAt, refundedBy: ctx.user.id, status: finalStatus },
        tx,
      );

      await AdmissionRepository.updateFeeBalance(ctx.orgId, updated.admissionId, tx);

      await AuditService.write(
        {
          orgId: ctx.orgId,
          userId: ctx.user.id,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          action: "payment.refunded",
          entityType: "payment",
          entityId: id,
          oldValue: { status: freshStatus, refundedAmount: freshRefundedAmount },
          newValue: { status: finalStatus, refundedAmount, notes: input.notes },
        },
        tx,
      );

      return updated;
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "refunded_payment",
      objectType: "payment",
      objectId: id,
      objectSnapshot: { amount: input.amount, status: payment.status, receiptNo: payment.receiptNo },
      targetType: "admission",
      targetId: payment.admissionId,
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "payment.refunded",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: payment.refundedAt?.toISOString() ?? new Date().toISOString(),
      data: {
        paymentId: id,
        admissionId: payment.admissionId,
        studentId: payment.studentId ?? undefined,
        amount: String(input.amount),
        refundedAmount: String(payment.refundedAmount),
        status: payment.status,
        receiptNo: payment.receiptNo ?? undefined,
      },
    });

    return payment;
  }

  /**
   * Ledger summary for an admission. feePaid/feeBalance are derived from the
   * payment cashflow via the authoritative calculation — never stale cached
   * fields — and exposed together with the cached values for transparency.
   */
  static async getSummaryByAdmission(ctx: RequestContext, admissionId: string) {
    const admission = await AdmissionRepository.findById(ctx.orgId, admissionId);
    if (!admission) throw new NotFoundError("Admission", admissionId);

    const rows = await prisma.paymentTransaction.findMany({
      where: { admissionId, orgId: ctx.orgId },
      select: { amount: true, refundedAmount: true, status: true },
    });
    const cashflow = toCashflow(rows);
    const { feePaid, feeBalance } = reconcileDerivedFields(
      cashflow,
      admission.feeFinal != null ? Number(admission.feeFinal) : null,
    );

    const refundedTotal = roundMoney(
      cashflow.reduce((sum, p) => sum + Math.max(0, Number(p.refundedAmount ?? 0)), 0),
    );

    return {
      admissionId,
      feeAmount: admission.feeAmount,
      feeDiscount: admission.feeDiscount,
      feeFinal: admission.feeFinal,
      feePaid,
      feeBalance,
      refundedTotal,
      paymentCount: rows.length,
      cached: {
        feePaid: admission.feePaid,
        feeBalance: admission.feeBalance,
      },
    };
  }
}