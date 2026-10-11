import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { createSubmissionKeyManager, paymentFingerprint } from "./submission-key";
import { PaymentService } from "@/lib/services/payment.service";
import { PaymentRepository } from "@/lib/repositories/payment.repository";
import { AdmissionRepository } from "@/lib/repositories/admission.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import type { RequestContext } from "@/types";

const ADM = "00000000-0000-4000-8000-00000000ad01";
const ORG = "00000000-0000-4000-8000-0000000000aa";
const form = { admissionId: ADM, amount: "5000", method: "UPI", feeType: "tuition", referenceNo: "" };

function counterIds() {
  let n = 0;
  return () => `key-${++n}`;
}

// ─── Client: one key per logical submission ─────────────────────────────────

test("single submission gets one key", () => {
  const m = createSubmissionKeyManager(counterIds());
  assert.equal(m.keyFor(form), "key-1");
});

test("double click / re-render with same form reuses the key", () => {
  const m = createSubmissionKeyManager(counterIds());
  const a = m.keyFor(form);
  const b = m.keyFor({ ...form });
  const c = m.keyFor({ ...form, amount: 5000 });
  assert.equal(a, b);
  assert.equal(a, c, "'5000' and 5000 are the same payment");
});

test("retry after a failed / timed-out request reuses the key", () => {
  const m = createSubmissionKeyManager(counterIds());
  const first = m.keyFor(form);
  // request failed: complete() is NOT called
  assert.equal(m.keyFor(form), first);
});

test("changing payment details or confirmed success rotates the key", () => {
  const m = createSubmissionKeyManager(counterIds());
  const first = m.keyFor(form);
  assert.notEqual(m.keyFor({ ...form, amount: "6000" }), first);
  const second = m.keyFor({ ...form, referenceNo: "UTR1" });
  m.complete(second);
  assert.notEqual(m.keyFor({ ...form, referenceNo: "UTR1" }), second, "a new identical payment after success is a new submission");
  m.complete("stale-key");
});

test("fingerprint distinguishes admissions, methods and fee types", () => {
  const base = paymentFingerprint(form);
  assert.notEqual(paymentFingerprint({ ...form, admissionId: "other" }), base);
  assert.notEqual(paymentFingerprint({ ...form, method: "CASH" }), base);
  assert.notEqual(paymentFingerprint({ ...form, feeType: "exam" }), base);
  assert.equal(paymentFingerprint({ ...form, referenceNo: "  " }), base);
});

// ─── Server: replay, concurrency, receipt uniqueness, balance ───────────────

const ctx = { orgId: ORG, user: { id: "u1", orgId: ORG, role: "ADMIN", name: "Cashier" }, requestId: "r", ipAddress: "x", userAgent: "t" } as unknown as RequestContext;

function ledger(feeFinal: number) {
  const payments: any[] = [];
  let receiptSeq = 0;
  let lock: Promise<void> = Promise.resolve();
  const orig = {
    tx: prisma.$transaction,
    evt: prisma.internalEvent.create,
    findById: PaymentRepository.findById,
    findByKey: PaymentRepository.findByIdempotencyKey,
    nextReceipt: PaymentRepository.getNextReceiptNo,
    create: PaymentRepository.create,
    bal: AdmissionRepository.updateFeeBalance,
    audit: AuditService.write,
    feed: ActivityFeedService.write,
    err: console.error,
  };
  const find = (id: string) => payments.find((p) => p.id === id) ?? null;
  const tx = {
    $queryRaw: async () => [{ id: ADM }],
    paymentTransaction: {
      findFirst: async (a: any) => payments.find((p) => p.idempotencyKey === a.where.idempotencyKey) ?? null,
      findMany: async () => payments.map((p) => ({ amount: p.amount, refundedAmount: 0, status: "COMPLETED" })),
    },
    admission: { findFirst: async () => ({ id: ADM, feeFinal, studentId: null, campusId: null }) },
  };
  // Serializes transactions like the admission-row FOR UPDATE lock does.
  (prisma as any).$transaction = async (fn: any) => {
    const prev = lock;
    let release!: () => void;
    lock = new Promise((r) => (release = r));
    await prev;
    try {
      return await fn(tx);
    } finally {
      release();
    }
  };
  (prisma.internalEvent as any).create = async () => { throw new Error("events disabled in unit test"); };
  (PaymentRepository as any).findById = async (_o: string, id: string) => find(id);
  (PaymentRepository as any).findByIdempotencyKey = async (_o: string, key: string) => payments.find((p) => p.idempotencyKey === key) ?? null;
  (PaymentRepository as any).getNextReceiptNo = async () => `RCP-${++receiptSeq}`;
  (PaymentRepository as any).create = async (_o: string, _a: string, _u: string, data: any) => {
    if (data.idempotencyKey && payments.some((p) => p.idempotencyKey === data.idempotencyKey)) {
      throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
    }
    const row = { id: `pay-${payments.length + 1}`, amount: data.amount, receiptNo: data.receiptNo, idempotencyKey: data.idempotencyKey, studentId: null };
    payments.push(row);
    return row;
  };
  (AdmissionRepository as any).updateFeeBalance = async () => {};
  (AuditService as any).write = async () => {};
  (ActivityFeedService as any).write = async () => {};
  console.error = () => {};
  return {
    payments,
    balance: () => feeFinal - payments.reduce((s, p) => s + Number(p.amount), 0),
    restore() {
      (prisma as any).$transaction = orig.tx;
      (prisma.internalEvent as any).create = orig.evt;
      (PaymentRepository as any).findById = orig.findById;
      (PaymentRepository as any).findByIdempotencyKey = orig.findByKey;
      (PaymentRepository as any).getNextReceiptNo = orig.nextReceipt;
      (PaymentRepository as any).create = orig.create;
      (AdmissionRepository as any).updateFeeBalance = orig.bal;
      (AuditService as any).write = orig.audit;
      (ActivityFeedService as any).write = orig.feed;
      console.error = orig.err;
    },
  };
}

const pay = (idempotencyKey: string, amount = 5000) =>
  ({ amount, method: "UPI", feeType: "tuition", idempotencyKey }) as any;

test("double click and network retry with the stable key record exactly one payment", async () => {
  const l = ledger(54000);
  try {
    const m = createSubmissionKeyManager(counterIds());
    const key = m.keyFor(form);
    const first = await PaymentService.create(ctx, ADM, pay(key));
    const replay = await PaymentService.create(ctx, ADM, pay(m.keyFor(form)));
    assert.equal(replay.id, first.id);
    assert.equal(replay.receiptNo, first.receiptNo);
    assert.equal(l.payments.length, 1);
    assert.equal(l.balance(), 49000);
  } finally {
    l.restore();
  }
});

test("concurrent submissions with one key produce one receipt", async () => {
  const l = ledger(54000);
  try {
    const results = await Promise.all([1, 2, 3, 4].map(() => PaymentService.create(ctx, ADM, pay("same-key"))));
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    assert.equal(l.payments.length, 1);
    assert.equal(l.balance(), 49000);
  } finally {
    l.restore();
  }
});

test("lost insert race (P2002) replays the winner instead of failing", async () => {
  const l = ledger(54000);
  try {
    const winner = await PaymentService.create(ctx, ADM, pay("race-key"));
    const baseTransaction = (prisma as any).$transaction;
    (prisma as any).$transaction = async (fn: any) =>
      baseTransaction(async (tx: any) =>
        fn({ ...tx, paymentTransaction: { ...tx.paymentTransaction, findFirst: async () => null } }),
      );
    const loser = await PaymentService.create(ctx, ADM, pay("race-key"));
    assert.equal(loser.id, winner.id);
    assert.equal(l.payments.length, 1);
  } finally {
    l.restore();
  }
});

test("different payments get distinct receipts and reduce the balance", async () => {
  const l = ledger(54000);
  try {
    const m = createSubmissionKeyManager(counterIds());
    const k1 = m.keyFor(form);
    const p1 = await PaymentService.create(ctx, ADM, pay(k1));
    m.complete(k1);
    const p2 = await PaymentService.create(ctx, ADM, pay(m.keyFor(form)));
    assert.notEqual(p1.id, p2.id);
    assert.notEqual(p1.receiptNo, p2.receiptNo);
    assert.equal(l.payments.length, 2);
    assert.equal(l.balance(), 44000);
  } finally {
    l.restore();
  }
});

test("replay does not bypass the overpayment guard for a new key", async () => {
  const l = ledger(5000);
  try {
    await PaymentService.create(ctx, ADM, pay("k-a"));
    await assert.rejects(PaymentService.create(ctx, ADM, pay("k-b")));
    assert.equal(l.payments.length, 1);
    assert.equal(l.balance(), 0);
  } finally {
    l.restore();
  }
});
