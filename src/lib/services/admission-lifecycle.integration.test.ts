/**
 * End-to-end admission → student → batch lifecycle integration tests against a
 * disposable PostgreSQL database. Gated by ADMISSION_INTEGRATION=1 so the
 * default `npm test` run stays dependency-free. Requires the migration deployed:
 *
 *   $env:ADMISSION_INTEGRATION="1"; $env:DATABASE_URL="postgresql://postgres:postgres@localhost:5433/airbone_test?schema=public"; $env:DIRECT_URL=$env:DATABASE_URL
 *   npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { AdmissionService } from "@/lib/services/admission.service";
import { AdmissionRepository } from "@/lib/repositories/admission.repository";
import { StudentService } from "@/lib/services/student.service";
import { ValidationError, NotFoundError } from "@/lib/utils/errors";
import type { RequestContext } from "@/types";

const ENABLED = process.env.ADMISSION_INTEGRATION === "1";

const hasDetail = (err: unknown, re: RegExp) => {
  assert.ok(err instanceof ValidationError);
  const details = err.details as { message?: string }[];
  return details.some((d) => re.test(d.message ?? ""));
};

let SEQ = 0;
const next = () => `${Date.now()}-${(SEQ++).toString(36)}`;

const ctx = (orgId: string, userId: string): RequestContext => ({
  orgId,
  user: {
    id: userId,
    orgId,
    campusId: null,
    name: "Test Admin",
    email: `test-admin-${userId}@example.com`,
    role: "ADMIN",
    avatarUrl: null,
  },
  requestId: `req-${orgId}`,
  ipAddress: "127.0.0.1",
  userAgent: "node:test",
});

async function seedOrg() {
  const suffix = next();
  const org = await prisma.organization.create({
    data: { name: `Adm-INT-${suffix}`, slug: `adm-int-${suffix}` },
  });
  const admin = await prisma.user.create({
    data: {
      orgId: org.id,
      name: "Adm Admin",
      email: `adm-admin-${suffix}@example.com`,
      role: "ADMIN",
      passwordHash: null,
    },
  });
  const campus = await prisma.campus.create({
    data: { orgId: org.id, name: "Delhi Campus", code: "DLH", city: "Delhi", state: "Delhi" },
  });
  const course = await prisma.course.create({
    data: {
      orgId: org.id,
      slug: `dgca-cpl-${suffix}`,
      title: "DGCA CPL Ground School",
      status: "PUBLISHED",
      fee: 100000,
    },
  });
  const feePlan = await prisma.feePlan.create({
    data: {
      orgId: org.id,
      name: "CPL Standard",
      items: {
        create: [
          { name: "Tuition", amount: 80000, sortOrder: 1 },
          { name: "Exam Fee", amount: 20000, sortOrder: 2 },
        ],
      },
    },
  });
  const lmsCourse = await prisma.lmsCourse.create({
    data: { orgId: org.id, slug: `lms-cpl-${suffix}`, title: "CPL Ground School LMS", status: "PUBLISHED", isPublished: true },
  });
  const batch = await prisma.lmsBatch.create({
    data: {
      orgId: org.id,
      courseId: lmsCourse.id,
      name: `Morning Batch ${suffix}`,
      startDate: new Date(Date.now() + 7 * 86400000),
      capacity: 1,
    },
  });
  return { orgId: org.id, adminId: admin.id, campusId: campus.id, courseId: course.id, feePlanId: feePlan.id, lmsCourseId: lmsCourse.id, batchId: batch.id };
}

async function seedLead(orgId: string, name: string, email?: string) {
  const suffix = next();
  return prisma.lead.create({
    data: {
      orgId,
      name,
      email,
      phone: `91${suffix.replace(/[^0-9]/g, "").slice(-10)}`,
      status: "NEW",
      score: 40,
    },
    select: { id: true },
  });
}

async function cleanup(orgId: string) {
  await Promise.all([
    prisma.activityFeedItem.deleteMany({ where: { orgId } }).catch(() => {}),
    prisma.internalEvent.deleteMany({ where: { orgId } }).catch(() => {}),
    prisma.eventLog.deleteMany({ where: { orgId } }).catch(() => {}),
    prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "orgId" = ${orgId}::uuid`.catch(() => {}),
  ]);
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
}

async function advanceTo(orgId: string, adminId: string, admissionId: string, targets: string[]) {
  const c = ctx(orgId, adminId);
  for (const stage of targets) {
    await AdmissionService.changeStage(c, admissionId, { toStage: stage as never });
  }
}

test("admission lifecycle: batch/course link, fee snapshot stability, course freeze after payment, campus isolation, deal reconcile, idempotent enrollment, capacity, student lifecycle", { skip: !ENABLED }, async () => {
  const { orgId, adminId, campusId, courseId, feePlanId, lmsCourseId, batchId } = await seedOrg();
  const c = ctx(orgId, adminId);
  let foreignCampusId: string | null = null;

  try {
    // ── 1. Phase H+M: create derives course/batch text from the canonical refs,
    //    and Phase N: fee-plan snapshot is captured at apply time.
    const lead1 = await seedLead(orgId, "Arjun Mehta", "arjun.admin@example.com");
    const app1 = await AdmissionService.create(c, {
      leadId: lead1.id,
      campusId,
      courseId,
      batchId,
      feePlanId,
      feeAmount: 100000,
      feeDiscount: 0,
    });
    const det1 = await AdmissionService.getById(c, app1.id);
    assert.equal(det1.courseName, "DGCA CPL Ground School", "courseName derives from Course.title");
    assert.equal(det1.batchName, (det1.batch as { name: string }).name, "batchName derives from the batch");
    assert.ok(det1.batchId === batchId, "batchId persisted on the admission");
    assert.ok(det1.courseId === courseId, "courseId persisted on the admission");
    const snapshot = (det1.metadata as Record<string, any>).feePlanSnapshot as any;
    assert.ok(snapshot, "fee plan snapshot recorded at creation");
    assert.equal(snapshot.planId, feePlanId);
    assert.equal(snapshot.items.length, 2);
    assert.equal(snapshot.items[0].resolvedAmount, 80000);
    assert.equal(snapshot.items[1].resolvedAmount, 20000);
    assert.equal(Number(det1.feeFinal), 100000);
    // Detail payload exposes the deal + batch joins.
    assert.ok(det1.batch && det1.course && "deal" in det1);

    // ── 2. Phase N: editing the master plan afterwards must NOT rewrite the
    //    admission's applied financial terms.
    const itemId = (await prisma.feePlanItem.findFirst({ where: { feePlanId } }))!.id;
    await prisma.feePlanItem.update({ where: { id: itemId }, data: { amount: 99999 } });
    const det1b = await AdmissionService.getById(c, app1.id);
    const snapB = (det1b.metadata as Record<string, any>).feePlanSnapshot.items as any[];
    assert.equal(snapB[0].resolvedAmount, 80000, "snapshot is immutable to later master-plan edits");
    assert.equal(Number(det1b.feeFinal), 100000, "feeFinal is a snapshot, not a live recompute");

    // ── 3. Phase M: once money has moved, the course is frozen.
    const payAdmission = await prisma.admission.create({
      data: {
        orgId, leadId: lead1.id, applicationNo: `INT-PAY-${next()}`, stage: "FEE_PAYMENT",
        courseName: "DGCA CPL Ground School", courseId, feeAmount: 100000, feeFinal: 100000, feePaid: 0, feeBalance: 100000, metadata: {},
      },
    });
    await prisma.paymentTransaction.create({
      data: {
        orgId, admissionId: payAdmission.id, amount: 10000, currency: "INR", method: "UPI", status: "COMPLETED",
        receiptNo: `RCP-PAY-${next()}`, idempotencyKey: `idem-pay-${next()}`,
      },
    });
    await AdmissionRepository.updateFeeBalance(orgId, payAdmission.id);
    await assert.rejects(
      AdmissionService.update(c, payAdmission.id, { courseName: "Aircraft Maintenance Engineering" }),
      (err) => hasDetail(err, /course after payments/),
    );

    // ── 4. Phase T: campusIds must belong to the org.
    const otherOrg = await prisma.organization.create({ data: { name: `Foreign-${next()}`, slug: `foreign-${next()}` } });
    foreignCampusId = (
      await prisma.campus.create({ data: { orgId: otherOrg.id, name: "Enemy", code: "EN", city: "Mumbai", state: "MH" } })
    ).id;
    const leadX = await seedLead(orgId, "Cross Org Sniff");
    await assert.rejects(
      AdmissionService.create(c, { leadId: leadX.id, campusId: foreignCampusId!, feeDiscount: 0 }),
      (err) => err instanceof NotFoundError && /Campus/.test((err as NotFoundError).message ?? ""),
    );

    // ── 5. Phase C/L: a non-terminal linked deal mirrors admission stage moves.
    const lead2 = await seedLead(orgId, "Sneha Rao", "sneha.admin@example.com");
    const app2 = await AdmissionService.create(c, {
      leadId: lead2.id, campusId, courseId, batchId, feePlanId, feeAmount: 100000, feeDiscount: 0,
    });
    const deal = await prisma.deal.create({
      data: {
        orgId, leadId: lead2.id, admissionId: app2.id, title: "Sneha — CPL", stage: "OFFER_LETTER",
      },
    });
    await advanceTo(orgId, adminId, app2.id, ["DOCUMENT_COLLECTION", "VERIFICATION", "OFFER_LETTER", "FEE_PAYMENT", "ENROLLED"]);
    const after = await prisma.deal.findUnique({ where: { id: deal.id } });
    assert.equal(after?.stage, "ENROLLED", "open deal mirrors the admission stage");
    assert.ok(after?.wonAt, "deal wonAt set on admission ENROLLED");

    // ── 6. Phase D/E: enrollment created exactly one student + derived batch
    //    membership + LMS enrollment; repeating the call is idempotent.
    const student = await prisma.student.findFirst({ where: { leadId: lead2.id, orgId } });
    assert.ok(student, "student auto-created from the lead");
    const memberships = await prisma.lmsBatchStudent.count({ where: { batchId, studentId: student!.id } });
    assert.equal(memberships, 1, "admission enrollment derives LmsBatchStudent membership");
    const lmsEnr = await prisma.lmsEnrollment.findFirst({ where: { studentId: student!.id, orgId } });
    assert.equal(lmsEnr?.courseId, lmsCourseId, "LMS enrollment uses the batch's course");
    assert.equal(lmsEnr?.batchId, batchId);
    assert.equal(lmsEnr?.status, "ACTIVE");
    assert.equal((await prisma.student.count({ where: { leadId: lead2.id, orgId } })), 1, "exactly one student");

    const repeat = await AdmissionService.changeStage(c, app2.id, { toStage: "ENROLLED" });
    assert.equal(repeat.id, app2.id, "repeat enrollment is an idempotent no-op");
    assert.equal(await prisma.student.count({ where: { leadId: lead2.id } }), 1, "no duplicate students on repeat");
    assert.equal(await prisma.lmsBatchStudent.count({ where: { batchId, studentId: student!.id } }), 1, "no duplicate membership on repeat");
    assert.equal(await prisma.admissionStageLog.count({ where: { admissionId: app2.id } }), 5, "no duplicate stage log on repeat");

    // ── 7. Phase I: enrollment into a full batch is blocked atomically.
    const lead3 = await seedLead(orgId, "Karan Bisht", "karan.admin@example.com");
    const app3 = await AdmissionService.create(c, { leadId: lead3.id, campusId, batchId, feeAmount: 100000, feeDiscount: 0 });
    await advanceTo(orgId, adminId, app3.id, ["DOCUMENT_COLLECTION", "VERIFICATION", "OFFER_LETTER", "FEE_PAYMENT"]);
    await assert.rejects(
      AdmissionService.changeStage(c, app3.id, { toStage: "ENROLLED" }),
      (err) => hasDetail(err, /capacity/),
    );
    assert.equal(await prisma.student.count({ where: { leadId: lead3.id } }), 0, "no student created when enrollment is blocked");

    // ── 7b. Phase I: final-slot race — two simultaneous ENROLLED calls into a
    //    capacity-1 batch must never exceed capacity.
    const raceBatch = await prisma.lmsBatch.create({
      data: { orgId, courseId: lmsCourseId, name: `Race Batch ${next()}`, capacity: 1 },
    });
    const raceLeadA = await seedLead(orgId, "Race A");
    const raceLeadB = await seedLead(orgId, "Race B");
    const raceAppA = await AdmissionService.create(c, { leadId: raceLeadA.id, campusId, batchId: raceBatch.id, feeAmount: 100000, feeDiscount: 0 });
    const raceAppB = await AdmissionService.create(c, { leadId: raceLeadB.id, campusId, batchId: raceBatch.id, feeAmount: 100000, feeDiscount: 0 });
    await advanceTo(orgId, adminId, raceAppA.id, ["DOCUMENT_COLLECTION", "VERIFICATION", "OFFER_LETTER", "FEE_PAYMENT"]);
    await advanceTo(orgId, adminId, raceAppB.id, ["DOCUMENT_COLLECTION", "VERIFICATION", "OFFER_LETTER", "FEE_PAYMENT"]);
    const [wa, wb] = await Promise.allSettled([
      AdmissionService.changeStage(c, raceAppA.id, { toStage: "ENROLLED" }),
      AdmissionService.changeStage(c, raceAppB.id, { toStage: "ENROLLED" }),
    ]);
    const winnerFulfilled = (wa.status === "fulfilled") !== (wb.status === "fulfilled");
    assert.ok(winnerFulfilled, "exactly one of two racing enrollments wins");
    const rejected = (wa.status === "rejected" ? wa : wb) as PromiseRejectedResult;
    assert.ok(hasDetail(rejected.reason, /capacity/), "the loser is rejected on capacity");
    assert.equal(
      await prisma.lmsBatchStudent.count({ where: { batchId: raceBatch.id } }),
      1,
      "batch membership never exceeds capacity under a final-slot race",
    );
    const stageA = (await prisma.admission.findUnique({ where: { id: raceAppA.id } }))?.stage;
    const stageB = (await prisma.admission.findUnique({ where: { id: raceAppB.id } }))?.stage;
    assert.equal([stageA, stageB].filter((s) => s === "ENROLLED").length, 1, "only the winner reaches ENROLLED");
    const studentsA = await prisma.student.count({ where: { leadId: raceLeadA.id } });
    const studentsB = await prisma.student.count({ where: { leadId: raceLeadB.id } });
    assert.equal(studentsA + studentsB, 1, "student provisioning is atomic — the loser leaves no orphan student");

    // ── 8. Phase O: student status lifecycle is canonical and propagates.
    const stu2 = await prisma.student.findUnique({ where: { id: student!.id } });
    assert.equal(stu2?.status, "ACTIVE");
    const grad = await StudentService.update(c, student!.id, { status: "GRADUATED" });
    assert.equal(grad.status, "GRADUATED");
    assert.ok(grad.graduatedAt, "graduatedAt timestamp derived server-side");
    await assert.rejects(
      StudentService.update(c, student!.id, { status: "ACTIVE" }),
      (err) => hasDetail(err, /Cannot transition/),
    );

    // Dropping a student propagates to their open LMS enrollments.
    const lead4 = await seedLead(orgId, "Drop Probe", "drop.admin@example.com");
    const std4 = await StudentService.create(c, {
      firstName: "Drop", lastName: "Probe",
      email: `drop-probe-${next()}@example.com`, phone: `99${next().replace(/[^0-9]/g, "").slice(-8)}`,
      nationality: "Indian", medicalFitness: false, leadId: lead4.id,
    });
    await prisma.lmsEnrollment.create({
      data: { orgId, studentId: std4.id, courseId: lmsCourseId, status: "ACTIVE" },
    });
    await StudentService.update(c, std4.id, { status: "DROPPED" });
    const enrAfterDrop = await prisma.lmsEnrollment.findUnique({
      where: { studentId_courseId: { studentId: std4.id, courseId: lmsCourseId } },
    });
    assert.equal(enrAfterDrop?.status, "DROPPED", "dropping the student suspends their LMS enrollment");
    assert.ok((await prisma.admission.findFirst({ where: { id: app2.id } }))?.studentId);

    // Cleanup of the extra org used for the isolation probe.
    await prisma.activityFeedItem.deleteMany({ where: { orgId: otherOrg.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: otherOrg.id } }).catch(() => {});
  } finally {
    await cleanup(orgId);
  }
});