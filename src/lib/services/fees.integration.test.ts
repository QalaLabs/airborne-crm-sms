/**
 * End-to-end fee/payment integrity tests against a disposable PostgreSQL
 * database. Gated by FEES_INTEGRATION=1 so the default `npm test` run stays
 * dependency-free. Requires a migrated database:
 *
 *   $env:FEES_INTEGRATION="1"; $env:DATABASE_URL="postgresql://..."; npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { PaymentService } from "@/lib/services/payment.service";
import { ValidationError } from "@/lib/utils/errors";
import type { RequestContext } from "@/types";

const ENABLED = process.env.FEES_INTEGRATION === "1";

const hasDetail = (err: unknown, re: RegExp) => {
  assert.ok(err instanceof ValidationError);
  const details = err.details as { message?: string }[];
  return details.some((d) => re.test(d.message ?? ""));
};

const createInput = (v: unknown) => v as Parameters<typeof PaymentService.create>[2];
const updateInput = (v: unknown) => v as Parameters<typeof PaymentService.update>[2];

const ctx = (orgId: string, userId: string): RequestContext => ({
  orgId,
  user: {
    id: userId,
    orgId,
    campusId: null,
    name: "Test Operator",
    email: `test-operator-${userId}@example.com`,
    role: "ADMIN",
    avatarUrl: null,
  },
  requestId: `req-${orgId}`,
  ipAddress: "127.0.0.1",
  userAgent: "node:test",
});

async function seedAdmission() {
  const org = await prisma.organization.create({
    data: { name: `INT-${Date.now()}`, slug: `int-${Date.now()}` },
  });
  const user = await prisma.user.create({
    data: {
      orgId: org.id,
      name: "Cashier",
      email: `cashier-${Date.now()}@example.com`,
      role: "ADMIN",
      passwordHash: null,
    },
  });
  const lead = await prisma.lead.create({
    data: { orgId: org.id, name: "Integ Test Lead", phone: `91${Date.now().toString().slice(-10)}` },
  });
  const admission = await prisma.admission.create({
    data: {
      orgId: org.id,
      leadId: lead.id,
      applicationNo: `INT-${Date.now()}`,
      stage: "FEE_PAYMENT",
      feeAmount: 100000,
      feeDiscount: 10000,
      feeFinal: 90000,
      feePaid: 0,
      feeBalance: 90000,
      metadata: {},
    },
    select: { id: true, applicationNo: true },
  });
  return { orgId: org.id, userId: user.id, admissionId: admission.id };
}

async function cleanup(orgId: string) {
  // Side effects written post-commit (activity feed, internal/event logs) hold
  // non-cascading FKs to the organization; clear them before deleting the org.
  await Promise.all([
    prisma.activityFeedItem.deleteMany({ where: { orgId } }),
    prisma.internalEvent.deleteMany({ where: { orgId } }),
    prisma.eventLog.deleteMany({ where: { orgId } }),
  ]).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
}

test("fee/payment integration: create → receipt, balance, idempotency, online/overpay rejects, adjustments, refunds", { skip: !ENABLED }, async () => {
  const { orgId, userId, admissionId } = await seedAdmission();
  const c = ctx(orgId, userId);

  try {
    // 1. First payment books a sequence receipt and reconciles the balance.
    const first = await PaymentService.create(c, admissionId, createInput({
      amount: 50000,
      method: "UPI",
      feeType: "tuition",
      referenceNo: `INT-REF-${Date.now()}`,
      idempotencyKey: "idem-first",
    }));
    assert.match(first.receiptNo ?? "", /^RCP-[0-9]{6}-\d{5}$/);

    const afterFirst = await prisma.admission.findFirst({ where: { id: admissionId }, select: { feePaid: true, feeBalance: true } });
    assert.equal(Number(afterFirst?.feePaid), 50000);
    assert.equal(Number(afterFirst?.feeBalance), 40000);

    // 2. Second payment via the same client idempotency key replays the first receipt.
    const replay = await PaymentService.create(c, admissionId, createInput({
      amount: 99999,
      method: "CASH",
      idempotencyKey: "idem-first",
    }));
    assert.equal(replay.id, first.id, "replay must return the original payment");
    // Replay path returns before validation; receipt is the original one.
    const afterReplay = await prisma.admission.findFirst({ where: { id: admissionId }, select: { feePaid: true } });
    assert.equal(Number(afterReplay?.feePaid), 50000, "replay must not book a second payment");

    // 3. ONLINE method is rejected at the service boundary.
    await assert.rejects(
      PaymentService.create(c, admissionId, createInput({ amount: 1000, method: "ONLINE" })),
      (err) => hasDetail(err, /payment gateway/),
    );

    // 4. Overpayment against the outstanding balance is rejected.
    await assert.rejects(
      PaymentService.create(c, admissionId, createInput({ amount: 90000, method: "CASH" })),
      (err) => hasDetail(err, /outstanding balance/),
    );

    // 5. Pay the rest; balance reaches exactly zero.
    const second = await PaymentService.create(c, admissionId, createInput({
      amount: 40000,
      method: "BANK_TRANSFER",
      referenceNo: `INT-REF-2-${Date.now()}`,
    }));
    assert.notEqual(second.id, first.id);
    const afterSecond = await prisma.admission.findFirst({ where: { id: admissionId }, select: { feePaid: true, feeBalance: true } });
    assert.equal(Number(afterSecond?.feePaid), 90000);
    assert.equal(Number(afterSecond?.feeBalance), 0);

    // 6. Partial refund moves the balance back and flags PARTIALLY_REFUNDED.
    await PaymentService.refund(c, second.id, { amount: 10000 });
    const partial = await prisma.paymentTransaction.findUnique({ where: { id: second.id }, select: { status: true, refundedAmount: true, refundedAt: true, refundedBy: true } });
    assert.equal(partial?.status, "PARTIALLY_REFUNDED");
    assert.equal(Number(partial?.refundedAmount), 10000);
    assert.ok(partial?.refundedAt);
    assert.equal(partial?.refundedBy, userId);

    // 7. Full refund of the remainder → REFUNDED, balance back to the full final.
    await PaymentService.refund(c, second.id, { amount: 30000 });
    const full = await prisma.paymentTransaction.findUnique({ where: { id: second.id }, select: { status: true, refundedAmount: true } });
    assert.equal(full?.status, "REFUNDED");
    assert.equal(Number(full?.refundedAmount), 40000);
    const afterFullRefund = await prisma.admission.findFirst({ where: { id: admissionId }, select: { feePaid: true, feeBalance: true } });
    assert.equal(Number(afterFullRefund?.feePaid), 50000);
    assert.equal(Number(afterFullRefund?.feeBalance), 40000);

    // 8. Refunding beyond the remaining amount is rejected.
    await assert.rejects(PaymentService.refund(c, first.id, { amount: 50001 }), (err) =>
      hasDetail(err, /exceeds the remaining refundable amount/),
    );

    // 9. Direct status PATCH to REFUNDED is rejected by the service guard.
    await assert.rejects(PaymentService.update(c, first.id, updateInput({ status: "REFUNDED" })), (err) =>
      hasDetail(err, /refund endpoint/),
    );

    // 10. Summary derives feePaid/feeBalance from live cashflow (net of refunds).
    const summary = await PaymentService.getSummaryByAdmission(c, admissionId);
    assert.equal(Number(summary.feeFinal), 90000);
    assert.equal(Number(summary.feePaid), 50000);
    assert.equal(Number(summary.feeBalance), 40000);
    assert.equal(Number(summary.refundedTotal), 40000);
    assert.equal(Number(summary.paymentCount), 2);
  } finally {
    await cleanup(orgId);
  }
});

test("M-01: concurrent refunds serialize via SELECT FOR UPDATE — never over-refund", { skip: !ENABLED }, async () => {
  const { orgId, userId, admissionId } = await seedAdmission();
  const c = ctx(orgId, userId);

  try {
    // Book the full 90,000 balance before testing refund concurrency.
    await PaymentService.create(c, admissionId, createInput({
      amount: 50000,
      method: "BANK_TRANSFER",
      referenceNo: `INT-REF-CONC-1-${Date.now()}`,
    }));
    const payment = await PaymentService.create(c, admissionId, createInput({
      amount: 40000,
      method: "BANK_TRANSFER",
      referenceNo: `INT-REF-CONC-2-${Date.now()}`,
    }));

    // Fire two independent refunds of the full payment concurrently, each with a
    // distinct requestId (events dedupe on orgId+name+requestId). Only one may
    // succeed: the row lock inside the transaction serializes them, and the
    // second sees the already-refunded state (or the final remaining = 0) and is
    // rejected. Without FOR UPDATE, both read refundedAmount=0 and both pass.
    const cA = { ...c, requestId: `req-${orgId}-a` };
    const cB = { ...c, requestId: `req-${orgId}-b` };
    const [a, b] = await Promise.allSettled([
      PaymentService.refund(cA, payment.id, { amount: 40000 }),
      PaymentService.refund(cB, payment.id, { amount: 40000 }),
    ]);

    const rejected = [a, b].filter((r) => r.status === "rejected").length;
    const fulfilled = [a, b].filter((r) => r.status === "fulfilled").length;

    // Exactly one refund succeeds; the other is rejected (either fully-refunded,
    // or refund amount exceeds the remaining). Both-allowed would be a double pay.
    assert.equal(fulfilled, 1, "exactly one of two concurrent full refunds must succeed");
    assert.equal(rejected, 1, "the other concurrent refund must be rejected");

    const final = await prisma.paymentTransaction.findUnique({
      where: { id: payment.id },
      select: { status: true, refundedAmount: true },
    });
    assert.equal(final?.status, "REFUNDED");
    assert.equal(Number(final?.refundedAmount), 40000);

    // Balance must reflect exactly one refund (50000 of 90000 remains paid).
    const summary = await PaymentService.getSummaryByAdmission(c, admissionId);
    assert.equal(Number(summary.refundedTotal), 40000);
    assert.equal(Number(summary.feePaid), 50000);
    assert.equal(Number(summary.feeBalance), 40000);
  } finally {
    await cleanup(orgId);
  }
});