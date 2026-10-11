import test from "node:test";
import assert from "node:assert/strict";
import {
  createPaymentSchema,
  updatePaymentSchema,
  refundPaymentSchema,
  paymentFiltersSchema,
} from "@/lib/validations/payment.schema";

test("createPaymentSchema accepts a valid 2-decimal offline payment", () => {
  const r = createPaymentSchema.safeParse({
    amount: 5000.5,
    method: "UPI",
    feeType: "tuition",
    referenceNo: "UTR1",
    idempotencyKey: "uuid-1",
  });
  assert.equal(r.success, true);
});

test("createPaymentSchema rejects amounts with more than 2 decimals", () => {
  assert.equal(createPaymentSchema.safeParse({ amount: 5000.001, method: "CASH" }).success, false);
});

test("createPaymentSchema rejects zero and negative amounts", () => {
  assert.equal(createPaymentSchema.safeParse({ amount: 0, method: "CASH" }).success, false);
  assert.equal(createPaymentSchema.safeParse({ amount: -10, method: "CASH" }).success, false);
});

test("createPaymentSchema rejects amounts above the maximum", () => {
  assert.equal(createPaymentSchema.safeParse({ amount: 10_000_000, method: "CASH" }).success, false);
});

test("createPaymentSchema rejects the ONLINE gateway method", () => {
  const r = createPaymentSchema.safeParse({ amount: 1000, method: "ONLINE" });
  assert.equal(r.success, false);
  if (!r.success) assert.match(r.error.issues[0]?.message ?? "", /ONLINE/);
});

test("updatePaymentSchema rejects REFUNDED status (refund endpoint only)", () => {
  const r = updatePaymentSchema.safeParse({ status: "REFUNDED" });
  assert.equal(r.success, false);
});

test("updatePaymentSchema rejects PARTIALLY_REFUNDED status", () => {
  assert.equal(updatePaymentSchema.safeParse({ status: "PARTIALLY_REFUNDED" }).success, false);
});

test("updatePaymentSchema allows ordinary status transitions", () => {
  assert.equal(updatePaymentSchema.safeParse({ status: "COMPLETED" }).success, true);
  assert.equal(updatePaymentSchema.safeParse({ status: "PENDING" }).success, true);
});

test("refundPaymentSchema accepts a valid refund amount", () => {
  assert.equal(refundPaymentSchema.safeParse({ amount: 2500 }).success, true);
});

test("refundPaymentSchema rejects over-max, >2dp, non-positive amounts", () => {
  assert.equal(refundPaymentSchema.safeParse({ amount: 10_000_000 }).success, false);
  assert.equal(refundPaymentSchema.safeParse({ amount: 0 }).success, false);
  assert.equal(refundPaymentSchema.safeParse({ amount: -1 }).success, false);
  assert.equal(refundPaymentSchema.safeParse({ amount: 1.234 }).success, false);
});

test("paymentFiltersSchema parses ledger filters with sensible defaults", () => {
  const r = paymentFiltersSchema.parse({
    search: "RCP-202609",
    status: "COMPLETED",
    feeType: "tuition",
    sortBy: "amount",
    sortDir: "asc",
    page: "3",
    limit: "20",
  });
  assert.equal(r.search, "RCP-202609");
  assert.equal(r.status, "COMPLETED");
  assert.equal(r.feeType, "tuition");
  assert.equal(r.sortBy, "amount");
  assert.equal(r.sortDir, "asc");
  assert.equal(r.page, 3);
  assert.equal(r.limit, 20);
  assert.equal(paymentFiltersSchema.parse({}).sortBy, "createdAt");
});