import test from "node:test";
import assert from "node:assert/strict";
import {
  PAYMENT_AMOUNT_MAX,
  computeFeeFinal,
  contributionNet,
  computeNetPaid,
  reconcileDerivedFields,
  formatReceiptNo,
  deriveIdempotencyKey,
  computePlanItemAmount,
  computePlanTotal,
  computeDueDate,
  paymentAmountError,
  roundMoney,
} from "@/lib/services/fee-calculation.service";

const COMPLETED = { status: "COMPLETED" };

test("computeFeeFinal subtracts discount from fee amount", () => {
  assert.equal(computeFeeFinal(100000, 10000), 90000);
});

test("computeFeeFinal returns null when no base fee is configured", () => {
  assert.equal(computeFeeFinal(null, 0), null);
  assert.equal(computeFeeFinal(undefined, 0), null);
});

test("contributionNet ignores PENDING payments", () => {
  assert.equal(contributionNet({ ...COMPLETED, status: "PENDING", amount: 50000 }), 0);
});

test("contributionNet ignores FAILED payments", () => {
  assert.equal(contributionNet({ ...COMPLETED, status: "FAILED", amount: 50000 }), 0);
});

test("contributionNet nets a partial refund", () => {
  assert.equal(contributionNet({ ...COMPLETED, amount: 100000, refundedAmount: 25000 }), 75000);
});

test("contributionNet for a fully refunded payment is zero", () => {
  assert.equal(contributionNet({ ...COMPLETED, status: "REFUNDED", amount: 100000, refundedAmount: 100000 }), 0);
});

test("contributionNet clamps to zero when refund exceeds amount", () => {
  assert.equal(contributionNet({ ...COMPLETED, amount: 100000, refundedAmount: 150000 }), 0);
});

test("computeNetPaid sums net contributions across payments", () => {
  assert.equal(
    computeNetPaid([
      { ...COMPLETED, amount: 30000 },
      { ...COMPLETED, amount: 30000, refundedAmount: 5000 },
    ]),
    55000,
  );
});

test("computeNetPaid excludes PENDING and FAILED entirely", () => {
  assert.equal(
    computeNetPaid([
      { ...COMPLETED, amount: 30000 },
      { ...COMPLETED, status: "PENDING", amount: 30000 },
      { ...COMPLETED, status: "FAILED", amount: 30000 },
    ]),
    30000,
  );
});

test("reconcileDerivedFields is zero when no fee is configured", () => {
  assert.deepEqual(reconcileDerivedFields([{ ...COMPLETED, amount: 5000 }], null), { feePaid: 0, feeBalance: 0 });
});

test("reconcileDerivedFields yields an outstanding balance when underpaid", () => {
  assert.deepEqual(reconcileDerivedFields([{ ...COMPLETED, amount: 30000 }], 90000), {
    feePaid: 30000,
    feeBalance: 60000,
  });
});

test("reconcileDerivedFields keeps a negative credit (unclamped) on overpayment", () => {
  assert.deepEqual(reconcileDerivedFields([{ ...COMPLETED, amount: 100000 }], 90000), {
    feePaid: 100000,
    feeBalance: -10000,
  });
});

test("reconcileDerivedFields fully paid nets to a zero balance", () => {
  assert.deepEqual(
    reconcileDerivedFields([{ ...COMPLETED, amount: 90000 }, { ...COMPLETED, amount: 10000, refundedAmount: 10000 }], 90000),
    { feePaid: 90000, feeBalance: 0 },
  );
});

test("formatReceiptNo produces RCP-YYYYMM-000NN padded to 5 digits", () => {
  assert.equal(formatReceiptNo(7, new Date("2026-09-05T10:00:00Z")), "RCP-202609-00007");
});

test("formatReceiptNo handles sequences past 99999 without truncation", () => {
  assert.equal(formatReceiptNo(120004, new Date("2026-09-05T10:00:00Z")), "RCP-202609-120004");
});

test("computeDueDate shifts a base date by the offset in days", () => {
  const base = new Date("2026-09-05T10:00:00Z");
  assert.equal(computeDueDate(base, 30).getDate(), 5);
  assert.equal(computeDueDate(base, 30).getMonth(), 9);
});

test("deriveIdempotencyKey is null without a reference", () => {
  assert.equal(deriveIdempotencyKey({ amount: 5000, method: "UPI" }), null);
  assert.equal(deriveIdempotencyKey({ referenceNo: "", amount: 5000, method: "UPI" }), null);
});

test("deriveIdempotencyKey is deterministic from reference, method and amount", () => {
  const a = deriveIdempotencyKey({ referenceNo: "UTR123", amount: 5000.5, method: "UPI" });
  const b = deriveIdempotencyKey({ referenceNo: "UTR123", amount: 5000.5, method: "UPI" });
  assert.ok(a);
  assert.equal(a, b);
  assert.equal(a, "ref:upi:UTR123:500050");
});

test("computePlanItemAmount resolves a percent item against the base fee", () => {
  assert.deepEqual(computePlanItemAmount({ percentOfFee: 25 }, 54000), { amount: 13500, needsBaseFee: false });
});

test("computePlanItemAmount percent item without base fee is unresolved", () => {
  assert.deepEqual(computePlanItemAmount({ percentOfFee: 25 }, null), { amount: null, needsBaseFee: true });
});

test("computePlanItemAmount fixed item ignores the base fee", () => {
  assert.deepEqual(computePlanItemAmount({ amount: 5000 }, 54000), { amount: 5000, needsBaseFee: false });
});

test("computePlanTotal sums fixed items only", () => {
  const r = computePlanTotal([{ percentOfFee: 25 }, { percentOfFee: 75 }], 54000);
  assert.deepEqual(r, { total: 54000, needsBaseFee: false, itemAmounts: [13500, 40500] });
});

test("computePlanTotal mixed plan resolves against base fee", () => {
  const r = computePlanTotal([{ amount: 5000 }, { percentOfFee: 50 }], 10000);
  assert.deepEqual(r, { total: 10000, needsBaseFee: false, itemAmounts: [5000, 5000] });
});

test("computePlanTotal percent-only plan without base fee is unresolved", () => {
  const r = computePlanTotal([{ percentOfFee: 50 }], null);
  assert.equal(r.needsBaseFee, true);
  assert.equal(r.total, 0);
  assert.deepEqual(r.itemAmounts, [null]);
});

test("paymentAmountError rejects more than two decimal places", () => {
  assert.match(paymentAmountError(5000.001, 90000) ?? "", /2 decimal places/);
});

test("paymentAmountError rejects amounts above the maximum", () => {
  assert.match(paymentAmountError(PAYMENT_AMOUNT_MAX + 1, 100000000) ?? "", /maximum/);
});

test("paymentAmountError rejects non-positive amounts", () => {
  assert.ok(paymentAmountError(0, 90000));
  assert.ok(paymentAmountError(-5, 90000));
});

test("paymentAmountError rejects amounts exceeding the outstanding balance", () => {
  assert.match(paymentAmountError(100000, 90000) ?? "", /outstanding balance/);
});

test("paymentAmountError accepts a valid amount at the outstanding balance", () => {
  assert.equal(paymentAmountError(90000, 90000), null);
});

test("roundMoney is stable on binary-float margins", () => {
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
});