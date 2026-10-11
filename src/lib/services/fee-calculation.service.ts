/**
 * Single authoritative source for all financial arithmetic in the admin app
 * (SECTION 2 — Fees / Payments / Ledger / Financial Integrity).
 *
 * Money is accumulated in integer cents to avoid float drift, then converted
 * back to 2-decimal rupee values. All functions are pure and framework-free so
 * they can be unit-tested directly and reused inside database transactions.
 */

export const PAYMENT_AMOUNT_MAX = 9_999_999.99;

/** Payment statuses that contribute toward the net paid total. */
export const NET_CONTRIBUTING_STATUSES = new Set([
  "COMPLETED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);

export interface PaymentCashflow {
  amount: number | string;
  refundedAmount?: number | string | null;
  status: string;
}

export interface PlanItemInput {
  name?: string;
  amount?: number | string | null;
  percentOfFee?: number | string | null;
  dueOffsetDays?: number;
}

export interface PlanComputation {
  total: number;
  needsBaseFee: boolean;
  itemAmounts: (number | null)[];
}

export function toCents(value: number | string): number {
  return Math.round(Number(value) * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * final payable = feeAmount − feeDiscount. Returns null when no base fee set.
 */
export function computeFeeFinal(
  feeAmount: number | string | null | undefined,
  feeDiscount: number | string | null | undefined,
): number | null {
  if (feeAmount === null || feeAmount === undefined) return null;
  if (Number(feeAmount) < 0) return null;
  return fromCents(toCents(feeAmount) - toCents(feeDiscount ?? 0));
}

/**
 * Net contribution of a single payment. PENDING/FAILED contribute zero.
 * A refunded payment contributes (amount − refundedAmount), never negative.
 */
export function contributionNet(payment: PaymentCashflow): number {
  if (!NET_CONTRIBUTING_STATUSES.has(payment.status)) return 0;
  const cents = toCents(payment.amount) - toCents(payment.refundedAmount ?? 0);
  return fromCents(Math.max(0, cents));
}

/**
 * Total actually paid into the admission across all payments, net of refunds.
 */
export function computeNetPaid(payments: PaymentCashflow[]): number {
  let totalCents = 0;
  for (const p of payments) {
    if (NET_CONTRIBUTING_STATUSES.has(p.status)) {
      totalCents += Math.max(0, toCents(p.amount) - toCents(p.refundedAmount ?? 0));
    }
  }
  return fromCents(totalCents);
}

export interface ReconciledFeeFields {
  feePaid: number;
  feeBalance: number;
}

/**
 * Derive the authoritative (feePaid, feeBalance) pair for an admission from its
 * payment cashflow and its cached feeFinal.
 *
 * feeBalance is NOT clamped: an overpayment produces a negative balance
 * (a credit against the admission) instead of silently discarding money.
 *
 * When no fee is configured (feeFinal null), nothing is due and nothing is paid.
 */
export function reconcileDerivedFields(
  payments: PaymentCashflow[],
  feeFinal: number | string | null | undefined,
): ReconciledFeeFields {
  if (feeFinal === null || feeFinal === undefined) {
    return { feePaid: 0, feeBalance: 0 };
  }
  const feePaid = computeNetPaid(payments);
  const feeBalance = fromCents(toCents(feeFinal) - toCents(feePaid));
  return { feePaid, feeBalance };
}

/**
 * Receipt number in the preserved RCP-YYYYMM-xxxxx format (5-digit sequence).
 */
export function formatReceiptNo(seq: number, date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `RCP-${year}${month}-${String(seq).padStart(5, "0")}`;
}

/**
 * Deterministic idempotency key derived from a payment reference so a
 * double-submit of the same bank transfer / cheque reconciles to one receipt.
 * Returns null when no reference is present (client may supply its own key).
 */
export function deriveIdempotencyKey(input: {
  referenceNo?: string | null;
  amount: number | string;
  method: string;
}): string | null {
  if (!input.referenceNo || !input.referenceNo.trim()) return null;
  return `ref:${input.method.toLowerCase()}:${input.referenceNo.trim()}:${toCents(input.amount)}`;
}

/**
 * Compute a fee-plan item's rupee amount. A percentOfFee item is a percentage
 * of the course fee (baseFee); it cannot be resolved without the base fee.
 */
export function computePlanItemAmount(
  item: PlanItemInput,
  baseFee: number | string | null | undefined,
): { amount: number | null; needsBaseFee: boolean } {
  if (item.percentOfFee !== null && item.percentOfFee !== undefined) {
    if (baseFee === null || baseFee === undefined) {
      return { amount: null, needsBaseFee: true };
    }
    const percent = Number(item.percentOfFee);
    return { amount: roundMoney((percent / 100) * Number(baseFee)), needsBaseFee: false };
  }
  return { amount: Number(item.amount ?? 0), needsBaseFee: false };
}

/**
 * Total rupee amount of a fee plan given a base course fee.
 * A plan containing percent items and no usable base fee is unresolved
 * (needsBaseFee = true).
 */
export function computePlanTotal(
  items: PlanItemInput[],
  baseFee: number | string | null | undefined,
): PlanComputation {
  let totalCents = 0;
  let needsBaseFee = false;
  const itemAmounts: (number | null)[] = [];

  for (const item of items) {
    const { amount, needsBaseFee: needsBase } = computePlanItemAmount(item, baseFee);
    if (needsBase) needsBaseFee = true;
    itemAmounts.push(amount);
    totalCents += toCents(amount ?? 0);
  }

  return needsBaseFee
    ? { total: 0, needsBaseFee: true, itemAmounts }
    : { total: fromCents(totalCents), needsBaseFee: false, itemAmounts };
}

/**
 * Due date for a plan item = base date shifted by the item's offset in days.
 */
export function computeDueDate(base: Date, offsetDays: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + (offsetDays ?? 0));
  return d;
}

/**
 * Validate a payment amount before it touches the ledger.
 * Returns an error message, or null when the amount is acceptable.
 */
export function paymentAmountError(
  amount: number,
  feeBalance: number | string | null | undefined,
): string | null {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Amount must be a positive number";
  }
  if (amount > PAYMENT_AMOUNT_MAX) {
    return `Amount exceeds the maximum of ${PAYMENT_AMOUNT_MAX.toLocaleString("en-IN")}`;
  }
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    return "Amount must not have more than 2 decimal places";
  }
  if (feeBalance !== null && feeBalance !== undefined && toCents(amount) > toCents(feeBalance)) {
    return `Amount exceeds the outstanding balance of ₹${fromCents(toCents(feeBalance)).toLocaleString("en-IN")}`;
  }
  return null;
}