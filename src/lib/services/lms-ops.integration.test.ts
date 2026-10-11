/**
 * LMS operational modules (attendance, assignments, certificates) integration
 * tests against a disposable PostgreSQL database. Gated by LMS_OPS_INTEGRATION=1
 * so the default `npm test` run stays dependency-free:
 *
 *   $env:LMS_OPS_INTEGRATION="1"; $env:DATABASE_URL="postgresql://postgres:postgres@localhost:5433/airbone_test?schema=public"; $env:DIRECT_URL=$env:DATABASE_URL
 *   npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { LmsService } from "@/lib/services/lms.service";
import { LmsOpsService } from "@/lib/services/lms-ops.service";
import { ForbiddenError, ConflictError, ValidationError } from "@/lib/utils/errors";
import type { RequestContext } from "@/types";

const ENABLED = process.env.LMS_OPS_INTEGRATION === "1";

let SEQ = 0;
const next = () => `${Date.now()}-${(SEQ++).toString(36)}`;

const ctx = (orgId: string, userId: string, role: RequestContext["user"]["role"] = "ADMIN"): RequestContext => ({
  orgId,
  user: {
    id: userId,
    orgId,
    campusId: null,
    name: "Test Admin",
    email: `test-admin-${userId}@example.com`,
    role,
    avatarUrl: null,
  },
  requestId: `req-${orgId}`,
  ipAddress: "127.0.0.1",
  userAgent: "node:test",
});

async function seedOrg() {
  const suffix = next();
  const org = await prisma.organization.create({ data: { name: `LMS-INT-${suffix}`, slug: `lms-int-${suffix}` } });
  const admin = await prisma.user.create({
    data: { orgId: org.id, name: "LMS Admin", email: `lms-admin-${suffix}@example.com`, role: "ADMIN", passwordHash: null },
  });
  const student = await prisma.student.create({
    data: {
      orgId: org.id,
      studentCode: `STU-${suffix}`,
      firstName: "LMS",
      lastName: "Learner",
      email: `lms-learner-${suffix}@example.com`,
      phone: `91${suffix.replace(/[^0-9]/g, "").slice(-10)}`,
      nationality: "Indian",
      medicalFitness: true,
    },
  });
  const unenrolled = await prisma.student.create({
    data: {
      orgId: org.id,
      studentCode: `STU-NE-${suffix}`,
      firstName: "Not",
      lastName: "Enrolled",
      email: `lms-unenrolled-${suffix}@example.com`,
      phone: `92${suffix.replace(/[^0-9]/g, "").slice(-10)}`,
      nationality: "Indian",
      medicalFitness: false,
    },
  });
  const lmsCourse = await prisma.lmsCourse.create({
    data: { orgId: org.id, slug: `lms-att-${suffix}`, title: "CPL Ground School LMS", status: "PUBLISHED", isPublished: true },
  });
  const batch = await prisma.lmsBatch.create({
    data: { orgId: org.id, courseId: lmsCourse.id, name: `Att Batch ${suffix}`, capacity: 10 },
  });
  const enrollment = await prisma.lmsEnrollment.create({
    data: { orgId: org.id, studentId: student.id, courseId: lmsCourse.id, batchId: batch.id, status: "ACTIVE" },
  });
  return { orgId: org.id, adminId: admin.id, studentId: student.id, unenrolledId: unenrolled.id, lmsCourseId: lmsCourse.id, batchId: batch.id, enrollment };
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

test("lms ops: attendance sessions + records, assignment submit/grade, certificate issue/verify/revoke", { skip: !ENABLED }, async () => {
  const { orgId, adminId, studentId, unenrolledId, lmsCourseId, batchId } = await seedOrg();
  const c = ctx(orgId, adminId);

  try {
    // ── Attendance ──────────────────────────────────────────────────────────
    const session = await LmsService.markAttendance(c, {
      courseId: lmsCourseId,
      batchId,
      title: "Navigation Induction",
      subjectTag: "Navigation",
      records: [
        { studentId, status: "PRESENT" },
        { studentId: unenrolledId, status: "ABSENT" },
      ],
    });
    assert.equal(session!.records.length, 2, "session created with its records atomically");
    assert.equal(session!.records.find((r) => r.studentId === studentId)?.status, "PRESENT");

    await assert.rejects(
      LmsService.markAttendance(c, { courseId: lmsCourseId, title: "Bad", records: [{ studentId: "00000000-0000-0000-0000-000000000000", status: "PRESENT" }] }),
      (err) => err instanceof ValidationError,
      "student ids outside the org are rejected",
    );

    const listed = await LmsService.getAttendanceForCourse(c, lmsCourseId, { batchId });
    assert.equal(listed.length, 1, "getAttendanceForCourse returns the course sessions");

    const updated = await LmsService.updateAttendanceSession(c, session!.id, {
      title: "Navigation Induction (Revised)",
      records: [{ studentId, status: "LATE" }],
    });
    assert.equal(updated!.title, "Navigation Induction (Revised)");
    assert.equal(updated!.records.find((r: { studentId: string }) => r.studentId === studentId)?.status, "LATE");
    assert.equal(
      await prisma.lmsAttendanceRecord.count({ where: { sessionId: session!.id } }),
      2,
      "a record-level update upserts without dropping other records",
    );

    await LmsService.deleteAttendanceSession(c, session!.id);
    assert.equal(await prisma.lmsAttendanceSession.count({ where: { id: session!.id } }), 0);
    assert.equal(await prisma.lmsAttendanceRecord.count({ where: { sessionId: session!.id } }), 0);

    // ── Assignments ─────────────────────────────────────────────────────────
    const assignment = await LmsOpsService.createAssignment(c, {
      courseId: lmsCourseId,
      batchId,
      title: "Nav Problem Set 1",
      maxScore: 50,
      dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      status: "PUBLISHED",
    });

    const sub = await LmsOpsService.submitAssignment(c, studentId, {
      assignmentId: assignment.id,
      body: "Solved all nav problems.",
    });
    assert.equal(sub.status, "SUBMITTED");

    await assert.rejects(
      LmsOpsService.submitAssignment(c, unenrolledId, { assignmentId: assignment.id, body: "no access" }),
      (err) => err instanceof ForbiddenError,
      "a non-enrolled student cannot submit",
    );

    const graded = await LmsOpsService.gradeSubmission(c, sub.id, { score: 42, feedback: "Great work", status: "GRADED" });
    assert.equal(graded.status, "GRADED");
    assert.equal(graded.score, 42);

    await assert.rejects(
      LmsOpsService.gradeSubmission(c, sub.id, { score: 51 }),
      (err) => err instanceof ConflictError,
      "score cannot exceed maxScore",
    );

    const detail = await LmsOpsService.getAssignment(c, assignment.id);
    assert.equal(detail.submissions.length, 1);
    assert.equal(detail.submissions[0]!.status, "GRADED");

    await LmsOpsService.deleteAssignment(c, assignment.id);
    assert.equal(await prisma.lmsAssignment.count({ where: { id: assignment.id } }), 0, "assignment + submissions removed");

    // ── Certificates ────────────────────────────────────────────────────────
    const cert = await LmsService.issueCertificate(c, { studentId, courseId: lmsCourseId, title: "CPL Ground School — Completion" });
    assert.equal(cert.status, "ISSUED");
    assert.ok(cert.certificateNo, "certificate number is server-generated");
    assert.ok(cert.verificationCode, "verification code is server-generated");

    const byCode = await LmsService.verifyCertificate(cert.verificationCode!);
    assert.equal(byCode?.id, cert.id, "verification code authenticates the certificate");
    assert.equal(byCode?.status, "ISSUED");

    const byDisplayNo = await LmsService.verifyCertificate(cert.certificateNo);
    assert.equal(byDisplayNo, null, "certificateNo is display-only and cannot be used to verify/enumerate");

    const mine = await LmsService.listCertificates(c, studentId);
    assert.equal(mine.length, 1);

    const revoked = await LmsService.revokeCertificate(c, cert.id);
    assert.equal(revoked.status, "REVOKED");
    assert.equal(await LmsService.verifyCertificate(cert.verificationCode!), null, "revoked certificates fail verification");

    await assert.rejects(
      LmsService.revokeCertificate(c, cert.id),
      (err) => err instanceof ConflictError,
      "a revoked certificate cannot be revoked again",
    );

    // ── Cross-org isolation ─────────────────────────────────────────────────
    const otherOrg = await prisma.organization.create({ data: { name: `Foreign-${next()}`, slug: `foreign-${next()}` } });
    const foreignStudent = await prisma.student.create({
      data: {
        orgId: otherOrg.id, studentCode: `STU-F-${next()}`, firstName: "F", lastName: "Foreign",
        email: `foreign-${next()}@example.com`, phone: `93${next().replace(/[^0-9]/g, "").slice(-8)}`,
        nationality: "Indian", medicalFitness: false,
      },
    });
    await assert.rejects(
      LmsService.markAttendance(c, { courseId: lmsCourseId, title: "sniff", records: [{ studentId: foreignStudent.id, status: "PRESENT" }] }),
      (err) => err instanceof ValidationError,
      "cross-org student injection is rejected",
    );
    await prisma.organization.deleteMany({ where: { id: otherOrg.id } }).catch(() => {});
  } finally {
    await cleanup(orgId);
  }
});