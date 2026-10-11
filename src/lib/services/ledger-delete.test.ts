import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { PaymentService } from "./payment.service";
import { FeePlanService } from "./fee-plan.service";
import { AuditService } from "./audit.service";
import { ActivityFeedService } from "./activity.service";
import { AdmissionRepository } from "@/lib/repositories/admission.repository";
import { AppError } from "@/lib/utils/errors";
import type { RequestContext } from "@/types";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const PAYMENT = "00000000-0000-4000-8000-0000000000e1";
const ADMISSION = "00000000-0000-4000-8000-0000000000d1";
const PLAN = "00000000-0000-4000-8000-0000000000f1";

function ctxAs(role: string) {
  return {
    orgId: ORG,
    user: { id: "u1", orgId: ORG, role, name: "Tester" },
    requestId: "req-1",
    ipAddress: "127.0.0.1",
    userAgent: "test",
  } as unknown as RequestContext;
}

const isForbidden = (e: unknown) => e instanceof AppError && e.statusCode === 403;

function paymentHarness() {
  const state = {
    rows: [
      {
        id: PAYMENT,
        orgId: ORG,
        admissionId: ADMISSION,
        studentId: null,
        amount: "5000",
        refundedAmount: "0",
        method: "UPI",
        status: "COMPLETED",
        receiptNo: "RCP-0001",
        referenceNo: "UTR1",
        feeType: "tuition",
        paidAt: new Date("2026-09-01T00:00:00Z"),
        createdAt: new Date("2026-09-01T00:00:00Z"),
      },
    ] as any[],
    rebalanced: [] as string[],
    audits: [] as any[],
    feed: [] as any[],
  };
  const orig = {
    tx: prisma.$transaction,
    rebalance: AdmissionRepository.updateFeeBalance,
    audit: AuditService.write,
    feed: ActivityFeedService.write,
  };
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      $queryRaw: async () => state.rows.filter((r) => r.id === PAYMENT).map((r) => ({ id: r.id })),
      paymentTransaction: {
        findFirst: async (a: any) => state.rows.find((r) => r.id === a.where.id && r.orgId === a.where.orgId) ?? null,
        delete: async (a: any) => {
          state.rows = state.rows.filter((r) => r.id !== a.where.id);
          return {};
        },
      },
    });
  (AdmissionRepository as any).updateFeeBalance = async (_org: string, id: string) => { state.rebalanced.push(id); };
  (AuditService as any).write = async (e: any) => { state.audits.push(e); };
  (ActivityFeedService as any).write = async (e: any) => { state.feed.push(e); };
  return {
    state,
    restore() {
      (prisma as any).$transaction = orig.tx;
      (AdmissionRepository as any).updateFeeBalance = orig.rebalance;
      (AuditService as any).write = orig.audit;
      (ActivityFeedService as any).write = orig.feed;
    },
  };
}

test("super admin deletes a ledger entry: row removed, balance re-derived, full row audited", async () => {
  const h = paymentHarness();
  try {
    const res = await PaymentService.remove(ctxAs("SUPER_ADMIN"), PAYMENT);
    assert.deepEqual(res, { id: PAYMENT, admissionId: ADMISSION });
    assert.equal(h.state.rows.length, 0);
    assert.deepEqual(h.state.rebalanced, [ADMISSION]);
    assert.equal(h.state.audits[0].action, "payment.deleted");
    assert.equal(h.state.audits[0].oldValue.amount, "5000");
    assert.equal(h.state.audits[0].oldValue.receiptNo, "RCP-0001");
    assert.equal(h.state.feed[0].verb, "deleted_payment");
  } finally {
    h.restore();
  }
});

test("non super admins cannot delete ledger entries", async () => {
  const h = paymentHarness();
  try {
    for (const role of ["ADMIN", "FINANCE", "COUNSELOR"]) {
      await assert.rejects(PaymentService.remove(ctxAs(role), PAYMENT), isForbidden);
    }
    assert.equal(h.state.rows.length, 1);
    assert.equal(h.state.audits.length, 0);
  } finally {
    h.restore();
  }
});

test("deleting an unknown ledger entry is 404 and writes nothing", async () => {
  const h = paymentHarness();
  try {
    h.state.rows = [];
    await assert.rejects(
      PaymentService.remove(ctxAs("SUPER_ADMIN"), PAYMENT),
      (e: unknown) => e instanceof AppError && e.statusCode === 404,
    );
    assert.equal(h.state.rebalanced.length, 0);
    assert.equal(h.state.audits.length, 0);
  } finally {
    h.restore();
  }
});

function planHarness() {
  const state = {
    plans: [
      {
        id: PLAN,
        orgId: ORG,
        courseId: null,
        name: "4 × 25%",
        isActive: true,
        items: [{ name: "Inst 1", amount: "0", percentOfFee: "25", dueOffsetDays: 0 }],
        _count: { admissions: 2 },
      },
    ] as any[],
    audits: [] as any[],
  };
  const orig = {
    find: prisma.feePlan.findFirst,
    del: prisma.feePlan.delete,
    audit: AuditService.write,
  };
  (prisma.feePlan as any).findFirst = async (a: any) =>
    state.plans.find((p) => p.id === a.where.id && p.orgId === a.where.orgId) ?? null;
  (prisma.feePlan as any).delete = async (a: any) => {
    state.plans = state.plans.filter((p) => p.id !== a.where.id);
    return {};
  };
  (AuditService as any).write = async (e: any) => { state.audits.push(e); };
  return {
    state,
    restore() {
      (prisma.feePlan as any).findFirst = orig.find;
      (prisma.feePlan as any).delete = orig.del;
      (AuditService as any).write = orig.audit;
    },
  };
}

test("super admin deletes a fee plan; linked admission count reported and audited", async () => {
  const h = planHarness();
  try {
    const res = await FeePlanService.remove(ctxAs("SUPER_ADMIN"), PLAN);
    assert.deepEqual(res, { id: PLAN, unlinkedAdmissions: 2 });
    assert.equal(h.state.plans.length, 0);
    assert.equal(h.state.audits[0].action, "fee_plan.deleted");
    assert.equal(h.state.audits[0].oldValue.name, "4 × 25%");
    assert.equal(h.state.audits[0].oldValue.linkedAdmissions, 2);
    assert.equal(h.state.audits[0].oldValue.items[0].percentOfFee, "25");
  } finally {
    h.restore();
  }
});

test("non super admins cannot delete fee plans; unknown plan is 404", async () => {
  const h = planHarness();
  try {
    await assert.rejects(FeePlanService.remove(ctxAs("ADMIN"), PLAN), isForbidden);
    assert.equal(h.state.plans.length, 1);
    await assert.rejects(
      FeePlanService.remove(ctxAs("SUPER_ADMIN"), "00000000-0000-4000-8000-0000000000ff"),
      (e: unknown) => e instanceof AppError && e.statusCode === 404,
    );
    assert.equal(h.state.audits.length, 0);
  } finally {
    h.restore();
  }
});
