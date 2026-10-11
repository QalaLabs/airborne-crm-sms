import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { resolveDecidedTerms } from "./deal.service";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const COURSE = "00000000-0000-4000-8000-0000000000c1";
const BATCH = "00000000-0000-4000-8000-0000000000b1";
const PLAN = "00000000-0000-4000-8000-0000000000f1";

function mock(opts: { courseFee?: number | null; course?: boolean; batch?: boolean; plan?: boolean }) {
  const orig = {
    course: prisma.course.findFirst,
    batch: prisma.lmsBatch.findFirst,
    plan: prisma.feePlan.findFirst,
  };
  (prisma.course as any).findFirst = async (a: any) =>
    opts.course === false || a.where.orgId !== ORG ? null : { fee: opts.courseFee ?? null };
  (prisma.lmsBatch as any).findFirst = async (a: any) =>
    opts.batch === false || a.where.orgId !== ORG ? null : { id: a.where.id };
  (prisma.feePlan as any).findFirst = async (a: any) =>
    opts.plan === false || a.where.orgId !== ORG ? null : { id: a.where.id };
  return () => {
    (prisma.course as any).findFirst = orig.course;
    (prisma.lmsBatch as any).findFirst = orig.batch;
    (prisma.feePlan as any).findFirst = orig.plan;
  };
}

test("decided course / batch / fee plan on the deal are carried to the admission", async () => {
  const restore = mock({ courseFee: 54000 });
  try {
    const r = await resolveDecidedTerms(ORG, {
      value: "60000",
      metadata: { courseId: COURSE, batchId: BATCH, feePlanId: PLAN },
    });
    assert.deepEqual(r, { courseId: COURSE, batchId: BATCH, feePlanId: PLAN, feeAmount: 60000 });
  } finally {
    restore();
  }
});

test("no decided fee → falls back to the course fee instead of a ₹0 dossier", async () => {
  const restore = mock({ courseFee: 54000 });
  try {
    const r = await resolveDecidedTerms(ORG, { value: null, metadata: { courseId: COURSE } });
    assert.equal(r.feeAmount, 54000);
  } finally {
    restore();
  }
});

test("references from another org / deleted records are dropped, fee stays undefined", async () => {
  const restore = mock({ course: false, batch: false, plan: false });
  try {
    const r = await resolveDecidedTerms(ORG, {
      value: 0,
      metadata: { courseId: COURSE, batchId: BATCH, feePlanId: PLAN },
    });
    assert.deepEqual(r, { courseId: undefined, batchId: undefined, feePlanId: undefined, feeAmount: undefined });
  } finally {
    restore();
  }
});
