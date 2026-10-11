import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { LmsOpsService } from "./lms-ops.service";
import { createBatchSchema, updateBatchSchema } from "@/lib/validations/lms.schema";
import { scheduleSummary } from "@/lib/lms/batch-schedule";
import { AppError } from "@/lib/utils/errors";
import type { RequestContext } from "@/types";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const COURSE = "00000000-0000-4000-8000-000000000c01";

const ctx = {
  orgId: ORG,
  user: { id: "u1", orgId: ORG, role: "ADMIN" },
  requestId: "req-1",
  ipAddress: "127.0.0.1",
  userAgent: "test",
} as unknown as RequestContext;

function harness() {
  const rows: any[] = [];
  const course = prisma.lmsCourse as any;
  const batch = prisma.lmsBatch as any;
  const member = prisma.lmsBatchStudent as any;
  const orig = {
    courseFind: course.findFirst,
    create: batch.create,
    findFirst: batch.findFirst,
    findMany: batch.findMany,
    update: batch.update,
    count: member.count,
  };
  course.findFirst = async (a: any) => (a.where.id === COURSE && a.where.orgId === ORG ? { id: COURSE } : null);
  batch.create = async (a: any) => {
    // JSON round-trip mirrors how Postgres stores the metadata column.
    const row = JSON.parse(JSON.stringify({ id: `b${rows.length + 1}`, metadata: {}, ...a.data }));
    rows.push(row);
    return row;
  };
  batch.findFirst = async (a: any) => {
    const r = rows.find((x) => x.id === a.where.id && x.orgId === a.where.orgId);
    return r ? { ...r, startDate: r.startDate ? new Date(r.startDate) : null, endDate: r.endDate ? new Date(r.endDate) : null } : null;
  };
  batch.findMany = async () => rows.map((r) => ({ ...r, course: { id: COURSE, title: "C" }, _count: { students: 0, teachers: 0, timetableSlots: 0 }, teachers: [] }));
  batch.update = async (a: any) => {
    const r = rows.find((x) => x.id === a.where.id);
    Object.assign(r, JSON.parse(JSON.stringify(a.data)));
    return r;
  };
  member.count = async () => 0;
  return {
    rows,
    restore() {
      course.findFirst = orig.courseFind;
      Object.assign(batch, { create: orig.create, findFirst: orig.findFirst, findMany: orig.findMany, update: orig.update });
      member.count = orig.count;
    },
  };
}

test("create persists frequency + time window in metadata and dates as columns; list returns them for display", async () => {
  const h = harness();
  try {
    const input = createBatchSchema.parse({
      courseId: COURSE,
      name: "CPL Nov Morning",
      type: "CUSTOM",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2027-01-31T00:00:00.000Z",
      schedule: { frequency: "DAILY", startTime: "09:00", endTime: "11:30" },
    });
    await LmsOpsService.createBatch(ctx, input);
    assert.deepEqual(h.rows[0].metadata, { schedule: { frequency: "DAILY", startTime: "09:00", endTime: "11:30" } });
    assert.equal(h.rows[0].startDate, "2026-11-01T00:00:00.000Z");
    assert.equal(h.rows[0].endDate, "2027-01-31T00:00:00.000Z");

    const [listed] = await LmsOpsService.listBatches(ctx);
    assert.equal(scheduleSummary(listed as any), "Daily · 9:00 AM – 11:30 AM · 1 Nov 2026 → 31 Jan 2027");
  } finally {
    h.restore();
  }
});

test("create rejects a course from another org", async () => {
  const h = harness();
  try {
    await assert.rejects(
      LmsOpsService.createBatch(ctx, createBatchSchema.parse({ courseId: "00000000-0000-4000-8000-000000000c09", name: "X" })),
      (e: unknown) => e instanceof AppError && e.statusCode === 404,
    );
    assert.equal(h.rows.length, 0);
  } finally {
    h.restore();
  }
});

test("update merges the schedule into existing metadata and keeps unrelated keys", async () => {
  const h = harness();
  try {
    await LmsOpsService.createBatch(ctx, createBatchSchema.parse({ courseId: COURSE, name: "A", schedule: { frequency: "WEEKLY", startTime: "18:00", endTime: "20:00" } }));
    h.rows[0].metadata.note = "keep me";
    await LmsOpsService.updateBatch(ctx, "b1", updateBatchSchema.parse({ schedule: { frequency: "BI_MONTHLY", startTime: "07:00", endTime: "08:15" } }));
    assert.deepEqual(h.rows[0].metadata, { note: "keep me", schedule: { frequency: "BI_MONTHLY", startTime: "07:00", endTime: "08:15" } });
  } finally {
    h.restore();
  }
});

test("update re-checks date order against the stored batch (backend never trusts the client)", async () => {
  const h = harness();
  try {
    await LmsOpsService.createBatch(ctx, createBatchSchema.parse({ courseId: COURSE, name: "A", startDate: "2026-11-01T00:00:00.000Z", endDate: "2027-01-31T00:00:00.000Z" }));
    await assert.rejects(
      LmsOpsService.updateBatch(ctx, "b1", updateBatchSchema.parse({ endDate: "2026-10-01T00:00:00.000Z" })),
      (e: unknown) => e instanceof AppError && e.statusCode === 400,
    );
    await assert.rejects(
      LmsOpsService.updateBatch(ctx, "b1", updateBatchSchema.parse({ startDate: "2027-03-01T00:00:00.000Z" })),
      (e: unknown) => e instanceof AppError && e.statusCode === 400,
    );
    assert.equal(h.rows[0].endDate, "2027-01-31T00:00:00.000Z", "rejected updates leave the row untouched");
    await LmsOpsService.updateBatch(ctx, "b1", updateBatchSchema.parse({ endDate: "2027-02-28T00:00:00.000Z" }));
    assert.equal(h.rows[0].endDate, "2027-02-28T00:00:00.000Z");
  } finally {
    h.restore();
  }
});
