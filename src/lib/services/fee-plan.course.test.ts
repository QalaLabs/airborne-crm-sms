import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { FeePlanService } from "./fee-plan.service";
import { AuditService } from "./audit.service";
import { buildFeePlanSnapshot } from "./admission.service";
import { computePlanTotal } from "./fee-calculation.service";
import {
  createFeePlanSchema,
  updateFeePlanSchema,
  feePlanFiltersSchema,
  percentSumError,
} from "@/lib/validations/fee-plan.schema";
import { AppError } from "@/lib/utils/errors";
import type { RequestContext } from "@/types";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000bb";
const COURSE_A = "00000000-0000-4000-8000-0000000000c1";
const COURSE_B = "00000000-0000-4000-8000-0000000000c2";
const FOREIGN_COURSE = "00000000-0000-4000-8000-0000000000c9";
const PLAN = "00000000-0000-4000-8000-0000000000f1";

const ctx = {
  orgId: ORG,
  user: { id: "u1", orgId: ORG, role: "ADMIN" },
  requestId: "req-1",
  ipAddress: "127.0.0.1",
  userAgent: "test",
} as unknown as RequestContext;

const courses = [
  { id: COURSE_A, orgId: ORG },
  { id: COURSE_B, orgId: ORG },
  { id: FOREIGN_COURSE, orgId: OTHER_ORG },
];

function harness(initialCourseId: string | null = null) {
  const plan: Record<string, any> = {
    id: PLAN,
    orgId: ORG,
    courseId: initialCourseId,
    name: "4 × 25%",
    isActive: true,
    currency: "INR",
    items: [],
  };
  const writes: { create: any[]; update: any[]; admissionWrites: number; audits: any[] } = {
    create: [],
    update: [],
    admissionWrites: 0,
    audits: [],
  };
  const orig = {
    courseFind: prisma.course.findFirst,
    planFind: prisma.feePlan.findFirst,
    planCreate: prisma.feePlan.create,
    tx: prisma.$transaction,
    admUpdate: prisma.admission.update,
    admUpdateMany: prisma.admission.updateMany,
    audit: AuditService.write,
  };
  (prisma.course as any).findFirst = async (a: any) =>
    courses.find((c) => c.id === a.where.id && c.orgId === a.where.orgId) ?? null;
  (prisma.feePlan as any).findFirst = async (a: any) =>
    a.where.id === PLAN && a.where.orgId === ORG ? { ...plan } : null;
  (prisma.feePlan as any).create = async (a: any) => {
    writes.create.push(a.data);
    return { id: PLAN, ...a.data, items: a.data.items.create };
  };
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      feePlanItem: { deleteMany: async () => ({}), createMany: async () => ({}) },
      feePlan: {
        update: async (a: any) => {
          writes.update.push(a.data);
          Object.assign(plan, a.data);
          return { ...plan };
        },
      },
    });
  (prisma.admission as any).update = async () => { writes.admissionWrites++; return {}; };
  (prisma.admission as any).updateMany = async () => { writes.admissionWrites++; return { count: 0 }; };
  (AuditService as any).write = async (e: any) => { writes.audits.push(e); };
  return {
    writes,
    restore() {
      (prisma.course as any).findFirst = orig.courseFind;
      (prisma.feePlan as any).findFirst = orig.planFind;
      (prisma.feePlan as any).create = orig.planCreate;
      (prisma as any).$transaction = orig.tx;
      (prisma.admission as any).update = orig.admUpdate;
      (prisma.admission as any).updateMany = orig.admUpdateMany;
      (AuditService as any).write = orig.audit;
    },
  };
}

const quarters = [25, 25, 25, 25].map((p, i) => ({ name: `Inst ${i + 1}`, percentOfFee: p, dueOffsetDays: i * 30 }));

test("create fee plan linked to a same-org course", async () => {
  const h = harness();
  try {
    const input = createFeePlanSchema.parse({ name: "4 × 25%", courseId: COURSE_A, items: quarters });
    const plan = await FeePlanService.create(ctx, input);
    assert.equal(h.writes.create[0].courseId, COURSE_A);
    assert.equal(h.writes.create[0].orgId, ORG);
    assert.equal(plan.courseId, COURSE_A);
    assert.equal(h.writes.audits[0].newValue.courseId, COURSE_A);
  } finally {
    h.restore();
  }
});

test("create without a course stays unmapped", async () => {
  const h = harness();
  try {
    await FeePlanService.create(ctx, createFeePlanSchema.parse({ name: "Flat", items: [{ name: "Full", amount: 54000 }] }));
    assert.equal(h.writes.create[0].courseId, null);
  } finally {
    h.restore();
  }
});

test("course from another organization is rejected on create and update", async () => {
  const h = harness(COURSE_A);
  try {
    await assert.rejects(
      FeePlanService.create(ctx, createFeePlanSchema.parse({ name: "X", courseId: FOREIGN_COURSE, items: quarters })),
      (e: unknown) => e instanceof AppError && e.statusCode === 400,
    );
    await assert.rejects(
      FeePlanService.update(ctx, PLAN, updateFeePlanSchema.parse({ courseId: FOREIGN_COURSE })),
      (e: unknown) => e instanceof AppError && e.statusCode === 400,
    );
    assert.equal(h.writes.create.length, 0);
    assert.equal(h.writes.update.length, 0);
  } finally {
    h.restore();
  }
});

test("edit mapping: re-link, unlink, and untouched when courseId omitted", async () => {
  const h = harness(COURSE_A);
  try {
    await FeePlanService.update(ctx, PLAN, updateFeePlanSchema.parse({ courseId: COURSE_B }));
    assert.equal(h.writes.update[0].courseId, COURSE_B);
    assert.deepEqual(h.writes.audits[0].oldValue.courseId, COURSE_A);
    assert.deepEqual(h.writes.audits[0].newValue.courseId, COURSE_B);

    await FeePlanService.update(ctx, PLAN, updateFeePlanSchema.parse({ name: "Renamed" }));
    assert.equal("courseId" in h.writes.update[1], false);

    await FeePlanService.update(ctx, PLAN, updateFeePlanSchema.parse({ courseId: null }));
    assert.equal(h.writes.update[2].courseId, null);
  } finally {
    h.restore();
  }
});

test("re-mapping a plan's course never rewrites historical admission snapshots", async () => {
  const h = harness(COURSE_A);
  try {
    const applied = {
      id: PLAN,
      name: "4 × 25%",
      courseId: COURSE_A,
      currency: "INR",
      isActive: true,
      items: quarters.map((q, i) => ({ ...q, amount: 0, sortOrder: i })),
    } as any;
    const snapshot = buildFeePlanSnapshot(applied, 54000, "u1", "2026-09-01T00:00:00.000Z");
    const frozen = JSON.stringify(snapshot);

    await FeePlanService.update(ctx, PLAN, updateFeePlanSchema.parse({ courseId: COURSE_B }));

    assert.equal(h.writes.admissionWrites, 0, "fee plan update must not touch admissions");
    assert.equal(JSON.stringify(snapshot), frozen);
    assert.equal(snapshot.courseId, COURSE_A);
    assert.deepEqual(snapshot.items.map((i) => i.resolvedAmount), [13500, 13500, 13500, 13500]);
  } finally {
    h.restore();
  }
});

test("percentage items must total exactly 100% when a plan uses them", () => {
  assert.equal(percentSumError(quarters), null);
  assert.equal(percentSumError([{ percentOfFee: 33.33 }, { percentOfFee: 33.33 }, { percentOfFee: 33.34 }]), null);
  assert.match(percentSumError([{ percentOfFee: 50 }, { percentOfFee: 30 }]) ?? "", /exactly 100%.*80%/);
  assert.equal(percentSumError([{ percentOfFee: null }, {}]), null);

  assert.equal(createFeePlanSchema.safeParse({ name: "Under", items: [{ name: "A", percentOfFee: 50 }] }).success, false);
  assert.equal(updateFeePlanSchema.safeParse({ items: [{ name: "A", percentOfFee: 60 }, { name: "B", percentOfFee: 30 }] }).success, false);
  assert.equal(
    createFeePlanSchema.safeParse({
      name: "Reg + split",
      items: [{ name: "Registration", amount: 5000 }, { name: "A", percentOfFee: 60 }, { name: "B", percentOfFee: 40 }],
    }).success,
    true,
  );
  assert.equal(createFeePlanSchema.safeParse({ name: "Fixed only", items: [{ name: "A", amount: 1000 }] }).success, true);
});

test("percentage plan totals resolve against the course fee", () => {
  assert.equal(computePlanTotal(quarters, 54000).total, 54000);
  assert.equal(computePlanTotal([{ amount: 5000 }, { percentOfFee: 60 }, { percentOfFee: 40 }], 50000).total, 55000);
  assert.equal(computePlanTotal(quarters, null).needsBaseFee, true);
});

test("filters accept a courseId and reject non-uuid values", () => {
  assert.equal(feePlanFiltersSchema.parse({ courseId: COURSE_A }).courseId, COURSE_A);
  assert.equal(feePlanFiltersSchema.safeParse({ courseId: "abc" }).success, false);
  assert.equal(createFeePlanSchema.safeParse({ name: "X", courseId: "abc", items: quarters }).success, false);
});
