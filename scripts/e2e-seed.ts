// Deterministic fixtures for the admin E2E suite. Refuses to run against
// anything but the loopback disposable test database (safe-db-check).
// Synthetic users and data only — the password below is a test-only value.
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { assertSafeDatabaseUrl } from "./safe-db-check.mjs";

export const E2E_PASSWORD = "E2e-Only-Password-1";
export const E2E_USERS = {
  superAdmin: { email: "e2e-superadmin@example.test", name: "E2E Super Admin", role: "SUPER_ADMIN" as const, isActive: true },
  staff: { email: "e2e-staff@example.test", name: "E2E Staff Member", role: "ADMIN" as const, isActive: true },
  inactive: { email: "e2e-inactive@example.test", name: "E2E Inactive User", role: "SUPPORT_STAFF" as const, isActive: false },
  counselor: { email: "e2e-counselor@example.test", name: "E2E Counselor", role: "ADMISSIONS_COUNSELOR" as const, isActive: true },
  content: { email: "e2e-content@example.test", name: "E2E Content Manager", role: "CONTENT_MANAGER" as const, isActive: true },
  teacher: { email: "e2e-teacher@example.test", name: "E2E Teacher", role: "TEACHER" as const, isActive: true },
  student: { email: "e2e-student@example.test", name: "E2E Student One", role: "STUDENT" as const, isActive: true },
  student2: { email: "e2e-student2@example.test", name: "E2E Student Two", role: "STUDENT" as const, isActive: true },
};
export const E2E_LMS = {
  assignedCourse: "e2e-att-assigned",
  unrelatedCourse: "e2e-att-unrelated",
  studentCode: "E2E-STU-0001",
  student2Code: "E2E-STU-0002",
  certificateNo: "E2E-CERT-0001",
  certificate2No: "E2E-CERT-0002",
  applicationNo: "E2E-APP-0001",
  receiptNo: "E2E-RCPT-0001",
  pagePerfLanding: "/e2e-landing-page",
};
export const E2E_COURSE_SLUG = "e2e-fee-course";
export const E2E_PENDING_TESTIMONIALS = 25;

async function main() {
  console.log(`[e2e-seed] ${assertSafeDatabaseUrl(process.env)}`);
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findFirst({ where: { slug: "airborne-aviation" }, select: { id: true } });
    if (!org) throw new Error("Org airborne-aviation missing — run the base seed on the disposable DB first.");

    const passwordHash = await argon2.hash(E2E_PASSWORD);
    for (const u of Object.values(E2E_USERS)) {
      await prisma.user.upsert({
        where: { email_orgId: { email: u.email, orgId: org.id } },
        create: { orgId: org.id, email: u.email, name: u.name, role: u.role, isActive: u.isActive, passwordHash },
        update: { name: u.name, role: u.role, isActive: u.isActive, passwordHash, deletedAt: null },
      });
    }

    await prisma.course.upsert({
      where: { orgId_slug: { orgId: org.id, slug: E2E_COURSE_SLUG } },
      create: { orgId: org.id, slug: E2E_COURSE_SLUG, title: "E2E Fee Course", status: "PUBLISHED", fee: 60000 },
      update: { title: "E2E Fee Course", status: "PUBLISHED", fee: 60000 },
    });

    await prisma.testimonial.deleteMany({ where: { orgId: org.id, authorName: { startsWith: "E2E " } } });
    await prisma.testimonial.createMany({
      data: Array.from({ length: E2E_PENDING_TESTIMONIALS }, (_, i) => ({
        orgId: org.id,
        authorName: `E2E Pending ${String(i + 1).padStart(2, "0")}`,
        content: `Synthetic pending testimonial number ${i + 1} for end-to-end tests.`,
        status: "PENDING" as const,
        source: "e2e",
      })),
    });

    await seedLmsAndLedger(prisma, org.id);
    await seedCms(prisma, org.id);

    const pending = await prisma.testimonial.count({ where: { orgId: org.id, status: "PENDING" } });
    console.log(`[e2e-seed] users=${Object.keys(E2E_USERS).length} pendingTestimonials=${pending}`);
  } finally {
    await prisma.$disconnect();
  }
}

/** CMS block registry (same types as prisma/seed-blocks.ts) and a clean slate for E2E pages / header menu. */
async function seedCms(prisma: PrismaClient, orgId: string) {
  const blocks = [
    { type: "heading", name: "Heading", schema: { type: "object", properties: { content: { type: "string" }, level: { type: "number" } }, required: ["content"] } },
    { type: "text", name: "Text", schema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] } },
    { type: "rich_text", name: "Rich Text", schema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] } },
    { type: "button", name: "Button", schema: { type: "object", properties: { label: { type: "string" }, href: { type: "string" } }, required: ["label", "href"] } },
  ];
  for (const b of blocks) {
    await prisma.contentBlock.upsert({
      where: { orgId_type: { orgId, type: b.type } },
      create: { orgId, type: b.type, name: b.name, schema: b.schema, defaultProps: {}, category: "Basic" },
      update: { name: b.name, schema: b.schema },
    });
  }
  await prisma.page.deleteMany({ where: { orgId, slug: { startsWith: "e2e-cms-page" } } });
  await prisma.navMenu.deleteMany({ where: { orgId, location: "header", name: { startsWith: "E2E " } } });
}

async function seedLmsAndLedger(prisma: PrismaClient, orgId: string) {
  const user = (email: string) => prisma.user.findFirstOrThrow({ where: { orgId, email }, select: { id: true } });
  const teacher = await user(E2E_USERS.teacher.email);
  const studentUser = await user(E2E_USERS.student.email);
  const student2User = await user(E2E_USERS.student2.email);

  const linkStudent = async (code: string, userId: string, firstName: string, email: string, phone: string) =>
    prisma.student.upsert({
      where: { orgId_studentCode: { orgId, studentCode: code } },
      create: { orgId, studentCode: code, userId, firstName, lastName: "E2E", email, phone, nationality: "Indian", medicalFitness: true, status: "ACTIVE" },
      update: { userId, firstName, lastName: "E2E", status: "ACTIVE", deletedAt: null },
    });
  const s1 = await linkStudent(E2E_LMS.studentCode, studentUser.id, "Student One", "e2e-student-record1@example.test", "9000000001");
  const s2 = await linkStudent(E2E_LMS.student2Code, student2User.id, "Student Two", "e2e-student-record2@example.test", "9000000002");

  const course = (slug: string, title: string) =>
    prisma.lmsCourse.upsert({
      where: { orgId_slug: { orgId, slug } },
      create: { orgId, slug, title, status: "PUBLISHED", isPublished: true },
      update: { title, status: "PUBLISHED", isPublished: true },
    });
  const assigned = await course(E2E_LMS.assignedCourse, "E2E Assigned Class");
  const unrelated = await course(E2E_LMS.unrelatedCourse, "E2E Unrelated Class");
  await prisma.lmsCourseTeacher.deleteMany({ where: { teacherId: teacher.id } });
  await prisma.lmsBatchTeacher.deleteMany({ where: { teacherId: teacher.id } });
  await prisma.lmsTimetableSlot.updateMany({ where: { teacherId: teacher.id }, data: { teacherId: null } });
  await prisma.lmsCourseTeacher.create({ data: { teacherId: teacher.id, courseId: assigned.id } });
  for (const s of [s1, s2]) {
    await prisma.lmsEnrollment.upsert({
      where: { studentId_courseId: { studentId: s.id, courseId: assigned.id } },
      create: { orgId, studentId: s.id, courseId: assigned.id, status: "ACTIVE" },
      update: { status: "ACTIVE" },
    });
  }

  const sessions = await prisma.lmsAttendanceSession.findMany({ where: { orgId, courseId: { in: [assigned.id, unrelated.id] } }, select: { id: true } });
  await prisma.lmsAttendanceRecord.deleteMany({ where: { sessionId: { in: sessions.map((x) => x.id) } } });
  await prisma.lmsAttendanceSession.deleteMany({ where: { id: { in: sessions.map((x) => x.id) } } });
  const seeded = await prisma.lmsAttendanceSession.create({
    data: { orgId, courseId: assigned.id, title: "E2E Navigation Class", heldAt: new Date("2026-09-14T04:30:00.000Z") },
  });
  await prisma.lmsAttendanceRecord.createMany({
    data: [
      { sessionId: seeded.id, studentId: s1.id, status: "PRESENT", markedBy: teacher.id },
      { sessionId: seeded.id, studentId: s2.id, status: "ABSENT", markedBy: teacher.id },
    ],
  });
  const unrelatedSession = await prisma.lmsAttendanceSession.create({
    data: { orgId, courseId: unrelated.id, title: "E2E Unrelated Session", heldAt: new Date("2026-09-15T04:30:00.000Z") },
  });
  await prisma.lmsAttendanceRecord.create({ data: { sessionId: unrelatedSession.id, studentId: s2.id, status: "PRESENT" } });

  await prisma.lmsCertificate.deleteMany({ where: { orgId, certificateNo: { in: [E2E_LMS.certificateNo, E2E_LMS.certificate2No] } } });
  await prisma.lmsCertificate.createMany({
    data: [
      { orgId, studentId: s1.id, courseId: assigned.id, certificateNo: E2E_LMS.certificateNo, verificationCode: "E2E-VERIFY-0001", title: "E2E Assigned Class", status: "ISSUED", issuedAt: new Date("2026-09-20T06:00:00.000Z") },
      { orgId, studentId: s2.id, courseId: assigned.id, certificateNo: E2E_LMS.certificate2No, verificationCode: "E2E-VERIFY-0002", title: "E2E Assigned Class", status: "ISSUED", issuedAt: new Date("2026-09-20T06:00:00.000Z") },
    ],
  });

  // Page-performance leads: fixed IST September dates with captured attribution.
  await prisma.lead.deleteMany({ where: { orgId, name: { startsWith: "E2E PagePerf " } } });
  await prisma.lead.createMany({
    data: [1, 2, 3].map((n) => ({
      orgId,
      name: `E2E PagePerf ${n}`,
      phone: `98000000${n}`,
      source: "COURSE_PAGE" as const,
      landingPage: n < 3 ? `https://airborne.example${E2E_LMS.pagePerfLanding}?utm_source=e2e` : "/e2e-other-page",
      referrerUrl: "https://www.google.com/",
      utmSource: "e2e",
      utmCampaign: "e2e-september",
      createdAt: new Date(`2026-09-1${n}T06:00:00.000Z`),
    })),
  });

  // Payment ledger: payment -> admission -> student (canonical relations).
  let admission = await prisma.admission.findFirst({ where: { orgId, applicationNo: E2E_LMS.applicationNo }, select: { id: true } });
  if (!admission) {
    const lead = await prisma.lead.create({ data: { orgId, name: "E2E Ledger Lead", phone: "9800000099", source: "DIRECT" } });
    admission = await prisma.admission.create({
      data: {
        orgId, leadId: lead.id, studentId: s1.id, applicationNo: E2E_LMS.applicationNo, stage: "FEE_PAYMENT",
        feeAmount: 50000, feeDiscount: 0, feeFinal: 50000, feePaid: 1000, feeBalance: 49000, metadata: {},
      },
      select: { id: true },
    });
  }
  await prisma.admission.update({ where: { id: admission.id }, data: { studentId: s1.id } });
  const receipt = await prisma.paymentTransaction.findFirst({ where: { orgId, receiptNo: E2E_LMS.receiptNo }, select: { id: true } });
  if (!receipt) {
    await prisma.paymentTransaction.create({
      data: { orgId, admissionId: admission.id, studentId: s1.id, amount: 1000, method: "CASH", status: "COMPLETED", receiptNo: E2E_LMS.receiptNo, paidAt: new Date("2026-09-21T06:00:00.000Z") },
    });
  }
}

main().catch((err) => {
  console.error("[e2e-seed] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
