import { z } from "zod";
import { PaymentMethod, PaymentStatus } from "@prisma/client";
import { PAYMENT_AMOUNT_MAX } from "@/lib/services/fee-calculation.service";

const twoDecimalPlaces = (v: number) =>
  Math.abs(v * 100 - Math.round(v * 100)) <= 1e-6;

// ONLINE requires a payment gateway, which is not configured.
// Onboarding a gateway is ouf-of-scope (Phase M); reject the method explicitly.
const nonOnlineMethod = z
  .nativeEnum(PaymentMethod)
  .refine((m) => m !== "ONLINE", {
    message: "ONLINE payments require a payment gateway which is not configured on this account",
  });

export const createPaymentSchema = z.object({
  amount: z
    .number()
    .positive()
    .max(PAYMENT_AMOUNT_MAX, `Amount must not exceed ${PAYMENT_AMOUNT_MAX}`)
    .refine(twoDecimalPlaces, { message: "Amount must not have more than 2 decimal places" }),
  currency: z.string().length(3).default("INR"),
  method: nonOnlineMethod,
  feeType: z.enum(["registration", "tuition", "exam", "hostel", "other"]).optional(),
  description: z.string().max(1000).optional(),
  referenceNo: z.string().max(255).optional(),
  // Client idempotency key (UUID) — double-submit protection for manual receipts.
  idempotencyKey: z.string().min(1).max(255).optional(),
  paidAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updatePaymentSchema = z.object({
  // REFUNDED / PARTIALLY_REFUNDED must be reached via the refund endpoint only,
  // which keeps refundedAmount / refundedAt / refundedBy consistent.
  status: z
    .nativeEnum(PaymentStatus)
    .refine((s) => s !== "REFUNDED" && s !== "PARTIALLY_REFUNDED", {
      message: "Refund statuses must be set through the refund endpoint",
    })
    .optional(),
  referenceNo: z.string().max(255).optional(),
  paidAt: z.string().datetime().optional().nullable(),
  notes: z.string().max(2000).optional(),
  gatewayTxnId: z.string().max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const paymentFiltersSchema = z.object({
  status: z.nativeEnum(PaymentStatus).optional(),
  method: z.nativeEnum(PaymentMethod).optional(),
  feeType: z.string().max(100).optional(),
  admissionId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  campusId: z.string().uuid().optional(),
  search: z.string().max(255).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "amount", "paidAt", "status"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export const refundPaymentSchema = z.object({
  amount: z
    .number()
    .positive()
    .max(PAYMENT_AMOUNT_MAX, `Amount must not exceed ${PAYMENT_AMOUNT_MAX}`)
    .refine(twoDecimalPlaces, { message: "Refund amount must not have more than 2 decimal places" }),
  notes: z.string().max(2000).optional(),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;
export type PaymentFilters = z.infer<typeof paymentFiltersSchema>;