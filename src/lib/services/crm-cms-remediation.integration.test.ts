/**
 * Analytics page performance, certificates, testimonials -> public API,
 * teacher/student attendance scope, lead source change and payment ledger
 * scope against a disposable PostgreSQL database. Gated by SECTION5_INTEGRATION=1.
 *
 *   npm run test:local
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { LeadService } from "@/lib/services/lead.service";
import { LmsService } from "@/lib/services/lms.service";
import { PaymentService } from "@/lib/services/payment.service";
import { TestimonialService } from "@/lib/services/testimonial.service";
import { LeadRepository } from "@/lib/repositories/lead.repository";
import { buildPagePerformance, NOT_CAPTURED } from "@/lib/analytics/page-performance";
import { buildAnalyticsReport } from "@/lib/analytics/report.service";
import { parseAnalyticsRange } from "@/lib/analytics/date-range";
import { leadExportRow } from "@/lib/leads/lead-export";
import { guard, guardRecord, getCounselorCondition } from "@/lib/middleware/permissions";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/utils/errors";
import { updateLeadSchema, leadFiltersSchema } from "@/lib/validations/lead.schema";
import { paymentFiltersSchema } from "@/lib/validations/payment.schema";
import type { RequestContext } from "@/types";

const ENABLED = process.env.SECTION5_INTEGRATION === "1";

let SEQ = 0;
const next = () => `${Date.now()}-${(SEQ++).toString(36)}`;
let PHONE = Math.floor(Math.random() * 1e6);
const phone = () => `94${Date.now().toString().slice(-5)}${String(PHONE++).padStart(6, "0")}`.slice(0, 15);

function ctx(orgId: string, userId: string, role: UserRole = "ADMIN"): RequestContext {
  return {
    orgId,
    user: { id: userId, orgId, campusId: null, name: `T ${role}`, email: `${userId}@example.com`, role, avatarUrl: null },
    requestId: randomUUID(),
    ipAddress: "127.0.0.1",
    userAgent: "node:test",
  };
}

async function seedOrg(label: string) {
  const suffix = next();
  const org = await prisma.organization.create({ data: { name: `${label}-${suffix}`, slug: `${label.toLowerCase()}-${suffix}` } });
  const mk = (role: UserRole, tag: string) =>
    prisma.user.create({ data: { orgId: org.id, name: `${tag} ${suffix}`, email: `${tag}-${suffix}@example.com`, role, passwordHash: null } });
  return {
    org,
    suffix,
    admin: await mk("ADMIN", "admin"),
    counselorA: await mk("ADMISSIONS_COUNSELOR", "ca"),
    counselorB: await mk("ADMISSIONS_COUNSELOR", "cb"),
    support: await mk("SUPPORT_STAFF", "support"),
    teacher: await mk("TEACHER", "teacher"),
    otherTeacher: await mk("TEACHER", "teacher2"),
    studentUserA: await mk("STUDENT", "stua"),
    studentUserB: await mk("STUDENT", "stub"),
  };
}

async function student(orgId: string, userId: string | null, tag: string) {
  const s = next();
  return prisma.student.create({
    data: {
      orgId,
      userId,
      studentCode: `STU-${tag}-${s}`,
      firstName: tag,
      lastName: "Learner",
      email: `${tag}-${s}@example.com`.toLowerCase(),
      phone: phone(),
      nationality: "Indian",
      medicalFitness: true,
    },
  });
}

async function lead(orgId: string, over: { assignedTo?: string | null; landingPage?: string | null; referrerUrl?: string | null; utmSource?: string | null; utmCampaign?: string | null; createdAt?: Date } = {}) {
  return prisma.lead.create({
    data: {
      orgId,
      name: `Lead ${next()}`,
      phone: phone(),
      source: "DIRECT",
      assignedTo: over.assignedTo ?? null,
      landingPage: over.landingPage ?? null,
      referrerUrl: over.referrerUrl ?? null,
      utmSource: over.utmSource ?? null,
      utmCampaign: over.utmCampaign ?? null,
      ...(over.createdAt ? { createdAt: over.createdAt } : {}),
    },
  });
}

async function cleanup(...orgIds: string[]) {
  for (const orgId of orgIds) {
    await Promise.all([
      prisma.activityFeedItem.deleteMany({ where: { orgId } }).catch(() => {}),
      prisma.internalEvent.deleteMany({ where: { orgId } }).catch(() => {}),
      prisma.eventLog.deleteMany({ where: { orgId } }).catch(() => {}),
      prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "orgId" = ${orgId}::uuid`.catch(() => {}),
    ]);
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
  }
}

// ── Item 7: lead source change ─────────────────────────────────────────────
test("lead source: authorized change persists, is audited, filterable, exported; RBAC + org enforced", { skip: !ENABLED }, async () => {
  const s = await seedOrg("SrcChg");
  const other = await seedOrg("SrcChgOther");
  try {
    const admin = ctx(s.org.id, s.admin.id);
    const l = await lead(s.org.id, { assignedTo: s.counselorA.id });

    const updated = await LeadService.update(admin, l.id, updateLeadSchema.parse({ source: "WALK_IN" }));
    assert.equal(updated?.source, "WALK_IN");
    assert.equal((await prisma.lead.findUnique({ where: { id: l.id } }))?.source, "WALK_IN", "persisted");

    const activity = await prisma.leadActivity.findFirst({ where: { leadId: l.id, title: "Source changed" } });
    assert.ok(activity, "timeline activity recorded");
    assert.deepEqual(activity?.metadata, { oldSource: "DIRECT", newSource: "WALK_IN" });
    const audit = await prisma.auditLog.findFirst({ where: { orgId: s.org.id, entityId: l.id, action: "lead.source_changed" } });
    assert.deepEqual(audit?.newValue, { source: "WALK_IN" });

    // Unchanged source writes no extra activity.
    await LeadService.update(admin, l.id, updateLeadSchema.parse({ source: "WALK_IN" }));
    assert.equal(await prisma.leadActivity.count({ where: { leadId: l.id, title: "Source changed" } }), 1);

    // List filter + export reflect the new source.
    const { page: _p, limit: _l, ...filters } = leadFiltersSchema.parse({ source: "WALK_IN" });
    const { data } = await LeadRepository.findMany(s.org.id, { ...leadFiltersSchema.parse({ source: "WALK_IN" }) });
    assert.deepEqual(data.map((d) => d.id), [l.id]);
    const exported: string[] = [];
    for await (const batch of LeadRepository.iterateForExport(s.org.id, filters, 50)) {
      for (const row of batch) exported.push(String(leadExportRow(row)[8]));
    }
    assert.deepEqual(exported, ["Walk-in"]);

    // Invalid enum value is a validation error (400).
    assert.throws(() => updateLeadSchema.parse({ source: "CARRIER_PIGEON" }));

    // Counselor: own lead allowed, other's lead forbidden (route guardRecord).
    const ca = ctx(s.org.id, s.counselorA.id, "ADMISSIONS_COUNSELOR");
    const cb = ctx(s.org.id, s.counselorB.id, "ADMISSIONS_COUNSELOR");
    const existing = await LeadService.getById(ca, l.id);
    guardRecord(ca.user, "write", "leads", existing as unknown as Record<string, unknown>, getCounselorCondition(ca.user));
    assert.throws(
      () => guardRecord(cb.user, "write", "leads", existing as unknown as Record<string, unknown>, getCounselorCondition(cb.user)),
      ForbiddenError,
    );
    // Read-only role cannot write leads.
    assert.throws(() => guard(ctx(s.org.id, s.support.id, "SUPPORT_STAFF").user, "write", "leads"), ForbiddenError);
    // Other org cannot see or change it.
    await assert.rejects(LeadService.update(ctx(other.org.id, other.admin.id), l.id, { source: "GOOGLE_ADS" }), NotFoundError);
    assert.equal((await prisma.lead.findUnique({ where: { id: l.id } }))?.source, "WALK_IN");
  } finally {
    await cleanup(s.org.id, other.org.id);
  }
});

// ── Item 8: payment ledger relations + counselor scope ─────────────────────
test("payment ledger: canonical admission/student relation, counselor scope, org isolation", { skip: !ENABLED }, async () => {
  const s = await seedOrg("Ledger");
  const other = await seedOrg("LedgerOther");
  try {
    const stu = await student(s.org.id, null, "Payer");
    const mkAdmission = async (assignedTo: string | null, counselorId: string | null, studentId: string | null) => {
      const l = await lead(s.org.id, { assignedTo });
      return prisma.admission.create({
        data: {
          orgId: s.org.id, leadId: l.id, studentId, counselorId, applicationNo: `LED-${next()}`, stage: "FEE_PAYMENT",
          feeAmount: 1000, feeDiscount: 0, feeFinal: 1000, feePaid: 0, feeBalance: 1000, metadata: {},
        },
      });
    };
    const ownByLead = await mkAdmission(s.counselorA.id, null, stu.id);
    const ownByCounselor = await mkAdmission(null, s.counselorA.id, null);
    const foreign = await mkAdmission(s.counselorB.id, s.counselorB.id, null);
    const pay = (admissionId: string, studentId: string | null) =>
      prisma.paymentTransaction.create({ data: { orgId: s.org.id, admissionId, studentId, amount: 100, method: "CASH", status: "COMPLETED", receiptNo: `R-${next()}` } });
    const p1 = await pay(ownByLead.id, stu.id);
    const p2 = await pay(ownByCounselor.id, null);
    const p3 = await pay(foreign.id, null);

    const filters = paymentFiltersSchema.parse({});
    const adminList = await PaymentService.list(ctx(s.org.id, s.admin.id), filters);
    assert.equal(adminList.total, 3);
    const row = adminList.data.find((p) => p.id === p1.id)!;
    assert.equal(row.admission?.id, ownByLead.id, "ledger links the canonical admission id");
    assert.equal(row.student?.id, stu.id, "ledger links the canonical student id");
    assert.equal(adminList.data.find((p) => p.id === p2.id)!.student, null, "missing student relation stays null");

    const ca = ctx(s.org.id, s.counselorA.id, "ADMISSIONS_COUNSELOR");
    const caList = await PaymentService.list(ca, filters);
    assert.deepEqual(new Set(caList.data.map((p) => p.id)), new Set([p1.id, p2.id]), "counselor sees own (lead assignee or admission counselor) only");
    await assert.rejects(PaymentService.getById(ca, p3.id), NotFoundError);
    assert.equal((await PaymentService.getById(ca, p1.id)).id, p1.id);

    await assert.rejects(PaymentService.getById(ctx(other.org.id, other.admin.id), p1.id), NotFoundError);
    assert.equal((await PaymentService.list(ctx(other.org.id, other.admin.id), filters)).total, 0);
    assert.throws(() => guard(ctx(s.org.id, s.teacher.id, "TEACHER").user, "read", "payments"), ForbiddenError);
  } finally {
    await cleanup(s.org.id, other.org.id);
  }
});

// ── Item 3: certificates ───────────────────────────────────────────────────
test("certificates: staff view by id, student own-issued only, org isolation, invalid ids", { skip: !ENABLED }, async () => {
  const s = await seedOrg("Cert");
  const other = await seedOrg("CertOther");
  try {
    const course = await prisma.lmsCourse.create({ data: { orgId: s.org.id, slug: `cert-${s.suffix}`, title: "CPL Ground", status: "PUBLISHED", isPublished: true } });
    const stuA = await student(s.org.id, s.studentUserA.id, "CertA");
    const stuB = await student(s.org.id, s.studentUserB.id, "CertB");
    const mk = (studentId: string, status: "ISSUED" | "REVOKED") =>
      prisma.lmsCertificate.create({
        data: { orgId: s.org.id, studentId, courseId: course.id, certificateNo: `C-${next()}`, verificationCode: `V-${next()}`, title: "CPL", status, issuedAt: new Date() },
      });
    const certA = await mk(stuA.id, "ISSUED");
    const revokedA = await mk(stuA.id, "REVOKED");
    const certB = await mk(stuB.id, "ISSUED");

    const admin = ctx(s.org.id, s.admin.id);
    const got = await LmsService.getCertificate(admin, certA.id);
    assert.equal(got.student.id, stuA.id);
    assert.equal(got.course.title, "CPL Ground");
    assert.equal(got.org.name, s.org.name);
    assert.equal((await LmsService.getCertificate(admin, revokedA.id)).status, "REVOKED", "staff can inspect revoked");

    const listed = await LmsService.listCertificates(admin, stuA.id);
    assert.deepEqual(new Set(listed.map((c) => c.id)), new Set([certA.id, revokedA.id]), "profile list is per student");

    const studentA = ctx(s.org.id, s.studentUserA.id, "STUDENT");
    assert.equal((await LmsService.getCertificate(studentA, certA.id)).id, certA.id);
    await assert.rejects(LmsService.getCertificate(studentA, certB.id), NotFoundError, "student A cannot view student B");
    await assert.rejects(LmsService.getCertificate(studentA, revokedA.id), NotFoundError, "revoked not shown to student");
    const ownList = await LmsService.listCertificates(studentA, stuB.id);
    assert.ok(ownList.every((c) => c.studentId === stuA.id), "studentId filter is overridden for students");

    await assert.rejects(LmsService.getCertificate(ctx(other.org.id, other.admin.id), certA.id), NotFoundError, "other org");
    await assert.rejects(LmsService.getCertificate(admin, "not-a-uuid"), NotFoundError);
    await assert.rejects(LmsService.getCertificate(admin, randomUUID()), NotFoundError, "deleted/missing");
    assert.throws(() => guard(ctx(s.org.id, s.counselorA.id, "ADMISSIONS_COUNSELOR").user, "read", "lms_certificates"), ForbiddenError);
  } finally {
    await cleanup(s.org.id, other.org.id);
  }
});

// ── Item 6: attendance ─────────────────────────────────────────────────────
test("attendance: teacher limited to assigned courses; student own-only; admin unrestricted", { skip: !ENABLED }, async () => {
  const s = await seedOrg("Att");
  const other = await seedOrg("AttOther");
  try {
    const assigned = await prisma.lmsCourse.create({ data: { orgId: s.org.id, slug: `att-a-${s.suffix}`, title: "Assigned", status: "PUBLISHED", isPublished: true } });
    const viaBatch = await prisma.lmsCourse.create({ data: { orgId: s.org.id, slug: `att-b-${s.suffix}`, title: "Via batch", status: "PUBLISHED", isPublished: true } });
    const unrelated = await prisma.lmsCourse.create({ data: { orgId: s.org.id, slug: `att-u-${s.suffix}`, title: "Unrelated", status: "PUBLISHED", isPublished: true } });
    await prisma.lmsCourseTeacher.create({ data: { teacherId: s.teacher.id, courseId: assigned.id } });
    const batch = await prisma.lmsBatch.create({ data: { orgId: s.org.id, courseId: viaBatch.id, name: `B ${s.suffix}`, capacity: 5 } });
    await prisma.lmsBatchTeacher.create({ data: { batchId: batch.id, teacherId: s.teacher.id } });
    await prisma.lmsCourseTeacher.create({ data: { teacherId: s.otherTeacher.id, courseId: unrelated.id } });

    const stuA = await student(s.org.id, s.studentUserA.id, "AttA");
    const stuB = await student(s.org.id, s.studentUserB.id, "AttB");
    const foreign = await student(other.org.id, null, "Foreign");

    const teacher = ctx(s.org.id, s.teacher.id, "TEACHER");
    const admin = ctx(s.org.id, s.admin.id);

    const courses = await LmsService.listAttendanceCourses(teacher);
    assert.deepEqual(new Set(courses.map((c) => c.id)), new Set([assigned.id, viaBatch.id]), "only assigned classes");
    assert.ok((await LmsService.listAttendanceCourses(admin)).length >= 3, "admin sees all");

    const session = await LmsService.markAttendance(teacher, {
      courseId: assigned.id, title: "Met 1", heldAt: "2026-09-10T04:30:00.000Z",
      records: [{ studentId: stuA.id, status: "PRESENT" }, { studentId: stuB.id, status: "ABSENT" }],
    });
    assert.equal(session?.records.length, 2, "existing marking works for assigned course");
    await LmsService.markAttendance(teacher, { courseId: viaBatch.id, batchId: batch.id, title: "Batch class", records: [{ studentId: stuA.id, status: "LATE" }] });

    await assert.rejects(
      LmsService.markAttendance(teacher, { courseId: unrelated.id, title: "x", records: [{ studentId: stuA.id, status: "PRESENT" }] }),
      ForbiddenError,
    );
    await assert.rejects(LmsService.getAttendanceForCourse(teacher, unrelated.id), ForbiddenError);
    await assert.rejects(LmsService.listEnrollments(teacher, unrelated.id), ForbiddenError);
    const adminSession = await LmsService.markAttendance(admin, { courseId: unrelated.id, title: "Admin class", records: [{ studentId: stuB.id, status: "PRESENT" }] });
    await assert.rejects(LmsService.updateAttendanceSession(teacher, adminSession!.id, { title: "hijack" }), ForbiddenError);
    await assert.rejects(LmsService.deleteAttendanceSession(teacher, adminSession!.id), ForbiddenError);

    await assert.rejects(
      LmsService.updateAttendanceSession(teacher, session!.id, { records: [{ studentId: foreign.id, status: "PRESENT" }] }),
      ValidationError,
      "cross-org student cannot be injected via update",
    );
    const edited = await LmsService.updateAttendanceSession(teacher, session!.id, { records: [{ studentId: stuB.id, status: "EXCUSED" }] });
    assert.equal(edited?.records.find((r) => r.studentId === stuB.id)?.status, "EXCUSED");

    // Date range: inside, outside (empty), and invalid.
    assert.equal((await LmsService.getAttendanceForCourse(teacher, assigned.id, { from: "2026-09-10T00:00:00.000Z", to: "2026-09-10T23:59:59.999Z" })).length, 1);
    assert.equal((await LmsService.getAttendanceForCourse(teacher, assigned.id, { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T00:00:00.000Z" })).length, 0);
    await assert.rejects(LmsService.getAttendanceForCourse(teacher, assigned.id, { from: "garbage" }), ValidationError);
    await assert.rejects(
      LmsService.getAttendanceForCourse(teacher, assigned.id, { from: "2026-09-11T00:00:00.000Z", to: "2026-09-10T00:00:00.000Z" }),
      ValidationError,
    );

    // Students: no staff attendance permission; own summary only.
    const studentA = ctx(s.org.id, s.studentUserA.id, "STUDENT");
    assert.throws(() => guard(studentA.user, "read", "lms_attendance"), ForbiddenError);
    assert.throws(() => guard(studentA.user, "write", "lms_attendance"), ForbiddenError);
    const own = await LmsService.getStudentAttendanceSummary(studentA, stuA.id);
    assert.equal(own.total, 2);
    assert.ok(own.records.every((r) => r.studentId === stuA.id));
    await assert.rejects(LmsService.getStudentAttendanceSummary(studentA, stuB.id), (e) => e instanceof ForbiddenError || e instanceof NotFoundError);

    // Org isolation for admins.
    await assert.rejects(LmsService.getAttendanceForCourse(ctx(other.org.id, other.admin.id), assigned.id), NotFoundError);
  } finally {
    await cleanup(s.org.id, other.org.id);
  }
});

// ── Item 4: testimonials -> public API ─────────────────────────────────────
async function publicTestimonials(orgId: string) {
  return prisma.testimonial.findMany({
    where: { orgId, status: "APPROVED" },
    orderBy: [{ isFeatured: "desc" }, { order: "asc" }, { createdAt: "desc" }],
    select: { id: true, content: true },
  });
}

test("testimonials: publish, update, unpublish, republish, ordering and delete reflect in the public query", { skip: !ENABLED }, async () => {
  const s = await seedOrg("Testi");
  const other = await seedOrg("TestiOther");
  try {
    const admin = () => ctx(s.org.id, s.admin.id, "ADMIN");
    const a = await TestimonialService.create(admin(), { authorName: "Aarav", content: "Cleared all DGCA papers first attempt.", metadata: {} });
    const b = await TestimonialService.create(admin(), { authorName: "Bhavya", content: "Great simulator sessions and mentors.", metadata: {} });
    assert.equal((await publicTestimonials(s.org.id)).length, 0, "pending is not public");

    await TestimonialService.review(admin(), a.id, { status: "APPROVED" });
    await TestimonialService.review(admin(), b.id, { status: "APPROVED" });
    assert.equal((await publicTestimonials(s.org.id)).length, 2);

    await TestimonialService.update(admin(), b.id, { order: 0, content: "Updated: great simulator sessions." });
    await TestimonialService.update(admin(), a.id, { order: 5 });
    const ordered = await publicTestimonials(s.org.id);
    assert.deepEqual(ordered.map((t) => t.id), [b.id, a.id], "order field drives public ordering");
    assert.equal(ordered[0]!.content, "Updated: great simulator sessions.");

    await TestimonialService.review(admin(), a.id, { status: "REJECTED" });
    assert.deepEqual((await publicTestimonials(s.org.id)).map((t) => t.id), [b.id], "unpublished disappears");
    await assert.rejects(TestimonialService.review(admin(), a.id, { status: "REJECTED" }), ValidationError, "no-op review rejected");
    await TestimonialService.review(admin(), a.id, { status: "APPROVED" });
    assert.equal((await publicTestimonials(s.org.id)).length, 2, "republished");

    await TestimonialService.update(admin(), a.id, { avatarId: null });
    await TestimonialService.delete(admin(), b.id);
    assert.deepEqual((await publicTestimonials(s.org.id)).map((t) => t.id), [a.id]);

    assert.equal((await publicTestimonials(other.org.id)).length, 0, "no cross-tenant leakage");
    await assert.rejects(TestimonialService.review(ctx(other.org.id, other.admin.id), a.id, { status: "REJECTED" }), NotFoundError);
    assert.throws(() => guard(ctx(s.org.id, s.counselorA.id, "ADMISSIONS_COUNSELOR").user, "update", "testimonials"), ForbiddenError);
  } finally {
    await cleanup(s.org.id, other.org.id);
  }
});

// ── Items 1 + 2: analytics date filter and separate page performance ──────
test("page performance: separate from sales report, date-filtered, counselor-scoped, org-isolated", { skip: !ENABLED }, async () => {
  const s = await seedOrg("PagePerf");
  const other = await seedOrg("PagePerfOther");
  try {
    const sept = new Date("2026-09-15T06:00:00.000Z");
    const aug = new Date("2026-08-10T06:00:00.000Z");
    const l1 = await lead(s.org.id, { assignedTo: s.counselorA.id, landingPage: "https://airborne.example/courses/cpl?utm_source=google", referrerUrl: "https://www.google.com/search", utmSource: "Google", utmCampaign: "cpl-sept", createdAt: sept });
    await lead(s.org.id, { assignedTo: s.counselorB.id, landingPage: "/courses/cpl/", createdAt: sept });
    await lead(s.org.id, { assignedTo: s.counselorA.id, landingPage: null, createdAt: sept });
    await lead(s.org.id, { assignedTo: s.counselorA.id, landingPage: "/cabin-crew", createdAt: aug });
    await lead(other.org.id, { landingPage: "/courses/cpl", createdAt: sept });
    await prisma.admission.create({
      data: { orgId: s.org.id, leadId: l1.id, applicationNo: `PP-${next()}`, stage: "FEE_PAYMENT", feeAmount: 1, feeDiscount: 0, feeFinal: 1, feePaid: 0, feeBalance: 1, metadata: {} },
    });

    const adminUser = { id: s.admin.id, role: "ADMIN" };
    const september = parseAnalyticsRange(new URLSearchParams({ from: "2026-09-01", to: "2026-09-30" }));
    const all = await buildPagePerformance(adminUser, s.org.id, null);
    assert.equal(all.totals.leads, 4);
    const sep = await buildPagePerformance(adminUser, s.org.id, september);
    assert.equal(sep.totals.leads, 3, "date filter applied in the database");
    const cpl = sep.pages.find((p) => p.page === "/courses/cpl");
    assert.deepEqual({ leads: cpl?.leads, admissions: cpl?.admissions, rate: cpl?.conversionRate }, { leads: 2, admissions: 1, rate: "50.0" });
    assert.equal(sep.pages.find((p) => p.page === NOT_CAPTURED)?.leads, 1);
    assert.equal(sep.pages.reduce((n, p) => n + p.leads, 0), sep.totals.leads, "no double counting across pages");
    assert.equal(sep.referrers.find((r) => r.key === "google.com")?.leads, 1);
    assert.equal(sep.utmCampaigns.find((r) => r.key === "cpl-sept")?.leads, 1);

    // Sales report is unaffected by the page-performance query and uses the same range.
    const sales = await buildAnalyticsReport(adminUser, s.org.id, september);
    assert.equal(sales.totals.leads, 3);
    assert.equal("pages" in sales, false, "page performance is not merged into the sales report");

    const counselor = await buildPagePerformance({ id: s.counselorA.id, role: "ADMISSIONS_COUNSELOR" }, s.org.id, september);
    assert.equal(counselor.totals.leads, 2, "counselor sees own leads only");
    const empty = await buildPagePerformance(adminUser, s.org.id, parseAnalyticsRange(new URLSearchParams({ from: "2026-01-01", to: "2026-01-02" })));
    assert.equal(empty.totals.leads, 0);
    assert.deepEqual(empty.pages, []);
    assert.equal((await buildPagePerformance({ id: other.admin.id, role: "ADMIN" }, other.org.id, september)).totals.leads, 1, "org isolation");
    assert.throws(() => guard(ctx(s.org.id, s.teacher.id, "TEACHER").user, "read", "analytics"), ForbiddenError);
  } finally {
    await cleanup(s.org.id, other.org.id);
  }
});
