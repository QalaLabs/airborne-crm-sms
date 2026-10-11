import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

// Credentials must never be hardcoded. Provisioned via env; random fallback when unset.
const superAdminEmail = process.env.SEED_SUPERADMIN_EMAIL ?? "superadmin@localhost";
const defaultPassword = process.env.SEED_DEFAULT_PASSWORD ?? randomUUID();
if (!process.env.SEED_SUPERADMIN_EMAIL) {
  console.warn("⚠️ SEED_SUPERADMIN_EMAIL not set — using non-routable placeholder.");
}
if (!process.env.SEED_DEFAULT_PASSWORD) {
  console.warn("⚠️ SEED_DEFAULT_PASSWORD not set — generated a random dev password.");
}

async function main() {
  console.log("🌱 Seeding Airborne Aviation Academy...\n");

  // ─── Organization ──────────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: "airborne-aviation" },
    update: {},
    create: {
      name: "Airborne Aviation Academy",
      slug: "airborne-aviation",
      domain: "airborne.academy",
      plan: "PROFESSIONAL",
      settings: {
        leadAutoAssign: false,
        defaultFollowUpDays: 2,
        workingHours: { start: "09:00", end: "18:00" },
      },
      featureFlags: {
        whatsappNotifications: true,
        emailNotifications: true,
        leadScoring: true,
        workflowAutomation: false,
      },
    },
  });
  console.log(`✅ Organization: ${org.name} (${org.id})`);

  // ─── Campuses ──────────────────────────────────────────────────────────────
  const campusDelhiData = {
    orgId: org.id,
    name: "Delhi Campus",
    code: "DEL",
    city: "New Delhi",
    state: "Delhi",
    country: "IN",
    address: "Plot 14, Aerocity, New Delhi 110037",
    phone: "+911140000001",
    email: "delhi@airborne.academy",
    timezone: "Asia/Kolkata",
    isActive: true,
  };

  const campusMumbaiData = {
    orgId: org.id,
    name: "Mumbai Campus",
    code: "MUM",
    city: "Mumbai",
    state: "Maharashtra",
    country: "IN",
    address: "BKC, Bandra Kurla Complex, Mumbai 400051",
    phone: "+912240000002",
    email: "mumbai@airborne.academy",
    timezone: "Asia/Kolkata",
    isActive: true,
  };

  const campusBangaloreData = {
    orgId: org.id,
    name: "Bangalore Campus",
    code: "BLR",
    city: "Bangalore",
    state: "Karnataka",
    country: "IN",
    address: "HAL Old Airport Road, Bangalore 560017",
    phone: "+918040000003",
    email: "bangalore@airborne.academy",
    timezone: "Asia/Kolkata",
    isActive: true,
  };

  const campusDelhi = await prisma.campus.upsert({
    where: { orgId_code: { orgId: org.id, code: "DEL" } },
    update: {},
    create: campusDelhiData,
  });

  const campusMumbai = await prisma.campus.upsert({
    where: { orgId_code: { orgId: org.id, code: "MUM" } },
    update: {},
    create: campusMumbaiData,
  });

  const campusBangalore = await prisma.campus.upsert({
    where: { orgId_code: { orgId: org.id, code: "BLR" } },
    update: {},
    create: campusBangaloreData,
  });

  console.log(`✅ Campuses: ${campusDelhi.name}, ${campusMumbai.name}, ${campusBangalore.name}`);

  // ─── Users — one per role ──────────────────────────────────────────────────
  const defaultPasswordHash = await hash(defaultPassword);

  const usersData = [
    {
      email: superAdminEmail,
      name: "Super Admin",
      role: "SUPER_ADMIN" as const,
      campusId: null,
    },
    {
      email: "admin@airborne.academy",
      name: "Org Admin",
      role: "ADMIN" as const,
      campusId: campusDelhi.id,
    },
    {
      email: "marketing@airborne.academy",
      name: "Priya Sharma",
      role: "MARKETING_MANAGER" as const,
      campusId: campusDelhi.id,
    },
    {
      email: "content@airborne.academy",
      name: "Rahul Gupta",
      role: "CONTENT_MANAGER" as const,
      campusId: campusDelhi.id,
    },
    {
      email: "counselor@airborne.academy",
      name: "Anjali Verma",
      role: "ADMISSIONS_COUNSELOR" as const,
      campusId: campusDelhi.id,
    },
    {
      email: "placement@airborne.academy",
      name: "Vikram Singh",
      role: "PLACEMENT_MANAGER" as const,
      campusId: campusMumbai.id,
    },
    {
      email: "support@airborne.academy",
      name: "Meena Patel",
      role: "SUPPORT_STAFF" as const,
      campusId: campusBangalore.id,
    },
  ];

  const createdUsers: Awaited<ReturnType<typeof prisma.user.upsert>>[] = [];

  for (const userData of usersData) {
    const user = await prisma.user.upsert({
      where: { email_orgId: { email: userData.email, orgId: org.id } },
      update: {},
      create: {
        orgId: org.id,
        email: userData.email,
        name: userData.name,
        passwordHash: defaultPasswordHash,
        role: userData.role,
        campusId: userData.campusId,
        isActive: true,
        emailVerified: new Date(),
      },
    });
    createdUsers.push(user);
    console.log(`  👤 ${user.role}: ${user.name} (${user.email})`);
  }

  console.log(`✅ Users: ${createdUsers.length} created`);

  // ─── RC demo accounts (idempotent; passwords match LMS seed) ───────────────
  const rcDemoUsers = [
    {
      email: "admin@airborneaviation.in",
      name: "Airborne Admin",
      role: "ADMIN" as const,
      password: "Admin@1234!",
    },
    {
      email: "demo.teacher@airborneaviation.in",
      name: "Demo Teacher",
      role: "TEACHER" as const,
      password: "DemoTeacher1!",
    },
    {
      email: "demo.student@airborneaviation.in",
      name: "Arjun Sharma",
      role: "STUDENT" as const,
      password: "DemoStudent1!",
    },
  ];

  for (const demo of rcDemoUsers) {
    const existing = await prisma.user.findFirst({
      where: { email: demo.email, orgId: org.id },
    });
    if (!existing) {
      await prisma.user.create({
        data: {
          orgId: org.id,
          email: demo.email,
          name: demo.name,
          passwordHash: await hash(demo.password),
          role: demo.role,
          campusId: campusDelhi.id,
          isActive: true,
          emailVerified: new Date(),
        },
      });
      console.log(`  👤 RC ${demo.role}: ${demo.email}`);
    } else {
      console.log(`  ℹ️  RC ${demo.role} exists: ${demo.email}`);
    }
  }

  // Assign head counselors to campuses
  const adminUser = createdUsers.find((u) => u.role === "ADMIN");
  const counselorUser = createdUsers.find((u) => u.role === "ADMISSIONS_COUNSELOR");

  if (adminUser) {
    await prisma.campus.update({
      where: { id: campusDelhi.id },
      data: { headCounselorId: counselorUser?.id ?? adminUser.id },
    });
  }

  // ─── Sample Leads ──────────────────────────────────────────────────────────
  const counselor = createdUsers.find((u) => u.role === "ADMISSIONS_COUNSELOR");

  const leadsData = [
    {
      name: "Arjun Kapoor",
      email: "arjun.k@gmail.com",
      phone: "+919812345001",
      city: "Delhi",
      state: "Delhi",
      courseInterest: "CPL (Commercial Pilot License)",
      source: "GOOGLE_ADS" as const,
      status: "NEW" as const,
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "cpl-course-2024",
    },
    {
      name: "Sneha Reddy",
      email: "sneha.r@yahoo.com",
      phone: "+919823456002",
      city: "Hyderabad",
      state: "Telangana",
      courseInterest: "CPL (Commercial Pilot License)",
      source: "FACEBOOK_ADS" as const,
      status: "CONTACTED" as const,
      utmSource: "facebook",
      utmMedium: "social",
      utmCampaign: "aviation-leads-q1",
    },
    {
      name: "Karan Mehta",
      email: "karan.m@hotmail.com",
      phone: "+919834567003",
      city: "Mumbai",
      state: "Maharashtra",
      courseInterest: "CPL (Commercial Pilot License)",
      source: "ORGANIC" as const,
      status: "INTERESTED" as const,
    },
    {
      name: "Pooja Nair",
      email: "pooja.n@gmail.com",
      phone: "+919845678004",
      city: "Bangalore",
      state: "Karnataka",
      courseInterest: "ATPL (Airline Transport Pilot License)",
      source: "REFERRAL" as const,
      status: "COUNSELED" as const,
      score: 75,
    },
    {
      name: "Rohit Sharma",
      email: "rohit.s@gmail.com",
      phone: "+919856789005",
      city: "Chandigarh",
      state: "Punjab",
      courseInterest: "CPL (Commercial Pilot License)",
      source: "WHATSAPP" as const,
      status: "FOLLOW_UP" as const,
    },
  ];

  for (const leadData of leadsData) {
    await prisma.lead.upsert({
      where: { orgId_phone: { orgId: org.id, phone: leadData.phone } },
      update: {},
      create: {
        orgId: org.id,
        createdBy: counselor?.id ?? createdUsers[0]!.id,
        assignedTo: counselor?.id,
        campusId: campusDelhi.id,
        ...leadData,
        score: leadData.score ?? 0,
        tags: ["2024-intake"],
        customFields: {},
        lastActivityAt: new Date(),
      },
    });
  }

  console.log(`✅ Leads: ${leadsData.length} sample leads created`);

  // ─── CRM Deal/Opportunity sample (SECTION 3) ───────────────────────────────
  // Reuses the canonical funnel stages; WON ⇔ ENROLLED, LOST ⇔ DROPPED/CANCELLED.
  const dealAcademy = createdUsers[0]!;
  const dealCounselor = counselor ?? dealAcademy;

  const demoteToProspect = async (phone: string): Promise<string> => {
    const lead = await prisma.lead.upsert({
      where: { orgId_phone: { orgId: org.id, phone } },
      update: { status: "PROSPECT", convertedAt: null, lostReason: null },
      create: {
        orgId: org.id,
        name: "Deal Demo Lead",
        phone,
        status: "PROSPECT",
        score: 50,
        createdBy: dealAcademy.id,
        customFields: {},
      },
    });
    return lead.id;
  };

  const ensureDeal = (
    leadId: string,
    data: {
      stage: string;
      title: string;
      value: number;
      wonAt?: Date | null;
      lostAt?: Date | null;
      lostReason?: string;
      convertedAt?: Date | null;
      admissionId?: string | null;
    },
  ) =>
    prisma.deal.upsert({
      where: { orgId_leadId: { orgId: org.id, leadId } },
      update: {
        stage: data.stage as never,
        title: data.title,
        value: data.value,
        wonAt: data.wonAt ?? null,
        lostAt: data.lostAt ?? null,
        lostReason: data.lostReason ?? null,
        convertedAt: data.convertedAt ?? null,
        admissionId: data.admissionId ?? null,
        isActive: data.wonAt || data.lostAt ? false : true,
      },
      create: {
        orgId: org.id,
        leadId,
        title: data.title,
        stage: data.stage as never,
        currency: "INR",
        value: data.value,
        assignedTo: dealCounselor.id,
        createdBy: dealAcademy.id,
        wonAt: data.wonAt ?? null,
        lostAt: data.lostAt ?? null,
        lostReason: data.lostReason ?? null,
        convertedAt: data.convertedAt ?? null,
        admissionId: data.admissionId ?? null,
        isActive: data.wonAt || data.lostAt ? false : true,
        metadata: {},
      },
    });

  // Lead A — open deal mid-funnel.
  const leadA = await demoteToProspect("+919812345001");
  await ensureDeal(leadA, { stage: "DOCUMENT_COLLECTION", title: "Arjun Kapoor — CPL (Commercial Pilot License)", value: 1850000 });

  // Lead B — open deal late-funnel.
  const leadB = await demoteToProspect("+919823456002");
  await ensureDeal(leadB, { stage: "OFFER_LETTER", title: "Sneha Reddy — CPL (Commercial Pilot License)", value: 1950000 });

  // Lead C — fresh open deal.
  const leadC = await demoteToProspect("+919834567003");
  await ensureDeal(leadC, { stage: "ENQUIRY", title: "Karan Mehta — CPL (Commercial Pilot License)", value: 1650000 });

  // Lead D — WON deal with a linked, enrolled Admission (drives dashboard).
  const wonLead = await prisma.lead.upsert({
    where: { orgId_phone: { orgId: org.id, phone: "+919845678004" } },
    update: { status: "WON", convertedAt: new Date(), lostReason: null },
    create: {
      orgId: org.id,
      name: "Pooja Nair",
      phone: "+919845678004",
      status: "PROSPECT",
      score: 75,
      createdBy: dealAcademy.id,
      customFields: {},
    },
  });
  const wonAdmission = await prisma.admission.upsert({
    where: { orgId_applicationNo: { orgId: org.id, applicationNo: "APP-DEMO-0001" } },
    update: { stage: "ENROLLED", studentId: null },
    create: {
      orgId: org.id,
      leadId: wonLead.id,
      applicationNo: "APP-DEMO-0001",
      stage: "ENROLLED",
      courseName: "CPL (Commercial Pilot License)",
      campusId: campusDelhi.id,
      counselorId: dealCounselor.id,
      stageChangedAt: new Date(),
      feeAmount: 1850000,
      feeFinal: 1850000,
      feePaid: 1850000,
      feeBalance: 0,
      metadata: {},
    },
  });
  await ensureDeal(wonLead.id, {
    stage: "ENROLLED",
    title: "Pooja Nair — CPL (Commercial Pilot License)",
    value: 1850000,
    wonAt: new Date(),
    convertedAt: new Date(),
    admissionId: wonAdmission.id,
  });

  // Lead E — LOST deal (drives lost metrics + reason surfacing).
  const lostLead = await demoteToProspect("+919856789005");
  await prisma.lead.update({
    where: { id: lostLead },
    data: { status: "LOST", lostReason: "Chose another academy" },
  });
  await ensureDeal(lostLead, {
    stage: "DROPPED",
    title: "Rohit Sharma — CPL (Commercial Pilot License)",
    value: 1650000,
    lostAt: new Date(),
    lostReason: "Chose another academy",
  });

  console.log(`✅ Deals: 5 demo deals seeded (2 open, 1 won + admission, 1 fresh, 1 lost)`);

  // ─── SECTION 4 — post-deal lifecycle (Admission → Student → Batch → LMS) ──
  // Canonical fee Course + fee plan + LMS counterpart, linked through a
  // realistic admitted → enrolled → paying student in a batch.
  const lifecycleAdmin = adminUser ?? dealAcademy;
  const lifecycleCounselor = counselor ?? dealCounselor;

  const course = await prisma.course.upsert({
    where: { orgId_slug: { orgId: org.id, slug: "dgca-cpl-ground-school" } },
    update: {},
    create: {
      orgId: org.id,
      slug: "dgca-cpl-ground-school",
      title: "DGCA CPL Ground School",
      status: "PUBLISHED",
      fee: 1850000,
    },
  });

  let feePlan = await prisma.feePlan.findFirst({
    where: { orgId: org.id, name: "CPL Ground School — Standard Plan" },
  });
  if (!feePlan) {
    feePlan = await prisma.feePlan.create({
      data: { orgId: org.id, name: "CPL Ground School — Standard Plan", currency: "INR", isActive: true },
    });
  }
  await prisma.feePlanItem.deleteMany({ where: { feePlanId: feePlan.id } });
  const planItems = [
    { name: "Registration", amount: 150000, percentOfFee: null, dueOffsetDays: -30, sortOrder: 1 },
    { name: "Tuition", amount: 1400000, percentOfFee: null, dueOffsetDays: 0, sortOrder: 2 },
    { name: "Exam & DGCA Fees", amount: 200000, percentOfFee: null, dueOffsetDays: 90, sortOrder: 3 },
    { name: "Materials & Misc", amount: 100000, percentOfFee: null, dueOffsetDays: 120, sortOrder: 4 },
  ];
  for (const item of planItems) {
    await prisma.feePlanItem.create({ data: { feePlanId: feePlan.id, ...item } });
  }

  const lmsCourse = await prisma.lmsCourse.upsert({
    where: { orgId_slug: { orgId: org.id, slug: "cpl-ground-school-lms" } },
    update: {},
    create: {
      orgId: org.id,
      slug: "cpl-ground-school-lms",
      title: "CPL Ground School (LMS)",
      status: "PUBLISHED",
      isPublished: true,
    },
  });

  let batch = await prisma.lmsBatch.findFirst({
    where: { orgId: org.id, name: "CPL March Intake 2026" },
  });
  if (!batch) {
    batch = await prisma.lmsBatch.create({
      data: {
        orgId: org.id,
        courseId: lmsCourse.id,
        name: "CPL March Intake 2026",
        type: "MORNING",
        startDate: new Date(Date.now() + 7 * 86400000),
        endDate: new Date(Date.now() + 370 * 86400000),
        capacity: 30,
      },
    });
  }

  // Student chain (idempotent by org+email).
  const lifecycleLead = await prisma.lead.upsert({
    where: { orgId_phone: { orgId: org.id, phone: "+919866770001" } },
    update: { status: "WON", convertedAt: new Date(), lostReason: null },
    create: {
      orgId: org.id,
      name: "Rohan Malhotra",
      email: "rohan.m@airborne.academy",
      phone: "+919866770001",
      city: "Delhi",
      state: "Delhi",
      courseInterest: course.title,
      source: "REFERRAL",
      status: "PROSPECT",
      score: 70,
      createdBy: lifecycleAdmin.id,
      assignedTo: lifecycleCounselor.id,
      campusId: campusDelhi.id,
      tags: ["2026-intake"],
      customFields: {},
      lastActivityAt: new Date(),
    },
  });

  let student = await prisma.student.findFirst({
    where: { orgId: org.id, email: "rohan.m@airborne.academy" },
  });
  if (!student) {
    student = await prisma.student.create({
      data: {
        orgId: org.id,
        studentCode: "STU-APP-4-DEMO-0001",
        firstName: "Rohan",
        lastName: "Malhotra",
        email: "rohan.m@airborne.academy",
        phone: "+919866770001",
        nationality: "Indian",
        gender: "MALE",
        dateOfBirth: new Date("2004-05-17T00:00:00.000Z"),
        address: { line1: "14 Mayur Vihar", city: "Delhi", state: "Delhi", pincode: "110091", country: "IN" },
        guardianName: "Rakesh Malhotra",
        guardianPhone: "+919866770002",
        medicalFitness: true,
        class12Stream: "SCIENCE",
        campusId: campusDelhi.id,
        leadId: lifecycleLead.id,
        status: "ACTIVE",
        enrolledAt: new Date(),
        customFields: {},
      },
    });
  } else {
    await prisma.student.update({ where: { id: student.id }, data: { leadId: lifecycleLead.id, status: "ACTIVE" } });
  }

  const snapshotAt = new Date().toISOString();
  const admission = await prisma.admission.upsert({
    where: { orgId_applicationNo: { orgId: org.id, applicationNo: "APP-4-DEMO-0001" } },
    update: {
      stage: "ENROLLED",
      courseId: course.id,
      courseName: course.title,
      batchId: batch.id,
      batchName: batch.name,
      batchStartDate: batch.startDate,
      feePlanId: feePlan.id,
      feeAmount: 1850000,
      feeDiscount: 0,
      feeFinal: 1850000,
      feePaid: 1850000,
      feeBalance: 0,
      studentId: student.id,
      stageChangedAt: new Date(),
      stageChangedBy: lifecycleAdmin.id,
      counselorId: lifecycleCounselor.id,
      campusId: campusDelhi.id,
    },
    create: {
      orgId: org.id,
      leadId: lifecycleLead.id,
      applicationNo: "APP-4-DEMO-0001",
      stage: "ENROLLED",
      courseId: course.id,
      courseName: course.title,
      batchId: batch.id,
      batchName: batch.name,
      batchStartDate: batch.startDate,
      feePlanId: feePlan.id,
      feeAmount: 1850000,
      feeDiscount: 0,
      feeFinal: 1850000,
      feePaid: 1850000,
      feeBalance: 0,
      studentId: student.id,
      stageChangedAt: new Date(),
      stageChangedBy: lifecycleAdmin.id,
      counselorId: lifecycleCounselor.id,
      campusId: campusDelhi.id,
      metadata: {
        feePlanSnapshot: {
          planId: feePlan.id,
          name: feePlan.name,
          currency: "INR",
          isActive: true,
          appliedAt: snapshotAt,
          appliedBy: lifecycleAdmin.id,
          items: planItems.map((i) => ({ ...i, percentOfFee: null, resolvedAmount: i.amount })),
        },
        enrollment: {
          enrolledAt: snapshotAt,
          enrolledBy: lifecycleAdmin.id,
          balanceAtEnrollment: 0,
          feeFinalAtEnrollment: 1850000,
          fullPaymentAtEnrollment: true,
        },
      },
    },
  });

  await ensureDeal(lifecycleLead.id, {
    stage: "ENROLLED",
    title: "Rohan Malhotra — DGCA CPL Ground School",
    value: 1850000,
    wonAt: new Date(),
    convertedAt: new Date(),
    admissionId: admission.id,
  });

  await prisma.paymentTransaction.upsert({
    where: { orgId_receiptNo: { orgId: org.id, receiptNo: "RCP-4-DEMO-0001" } },
    update: {},
    create: {
      orgId: org.id,
      admissionId: admission.id,
      studentId: student.id,
      campusId: campusDelhi.id,
      amount: 1850000,
      currency: "INR",
      method: "BANK_TRANSFER",
      status: "COMPLETED",
      receiptNo: "RCP-4-DEMO-0001",
      idempotencyKey: "idem-4-demo-0001",
      feeType: "tuition",
      paidAt: new Date(),
      collectedBy: lifecycleAdmin.id,
      notes: "Full fee payment — seeded lifecycle demo",
    },
  });

  await prisma.lmsBatchStudent.upsert({
    where: { batchId_studentId: { batchId: batch.id, studentId: student.id } },
    create: { batchId: batch.id, studentId: student.id },
    update: {},
  });

  await prisma.lmsEnrollment.upsert({
    where: { studentId_courseId: { studentId: student.id, courseId: lmsCourse.id } },
    update: { batchId: batch.id, status: "ACTIVE" },
    create: {
      orgId: org.id,
      studentId: student.id,
      courseId: lmsCourse.id,
      batchId: batch.id,
      status: "ACTIVE",
    },
  });

  let attSession = await prisma.lmsAttendanceSession.findFirst({
    where: { orgId: org.id, title: "DGCA Nav Theory — Induction" },
  });
  if (!attSession) {
    attSession = await prisma.lmsAttendanceSession.create({
      data: {
        orgId: org.id,
        courseId: lmsCourse.id,
        batchId: batch.id,
        title: "DGCA Nav Theory — Induction",
        subjectTag: "Navigation",
        heldAt: new Date(Date.now() - 2 * 86400000),
      },
    });
  }
  await prisma.lmsAttendanceRecord.upsert({
    where: { sessionId_studentId: { sessionId: attSession.id, studentId: student.id } },
    update: {},
    create: {
      sessionId: attSession.id,
      studentId: student.id,
      status: "PRESENT",
      markedBy: lifecycleAdmin.id,
      markedAt: new Date(),
    },
  });

  console.log(
    `✅ Lifecycle seed: ${course.title} · ${feePlan.name} (${planItems.length} items) · ${lmsCourse.title} · ${batch.name} (cap ${batch.capacity}) · ${admission.applicationNo} ENROLLED · ${student.studentCode} · payment ${admission.feePaid} · LMS ${attSession.title}`,
  );

  // ─── Notification Templates ─────────────────────────────────────────────────
  const templates = [
    {
      orgId: org.id,
      name: "New Lead WhatsApp Welcome",
      event: "NEW_LEAD" as const,
      channel: "WHATSAPP" as const,
      subject: null,
      body: "Hi {{leadName}}, thank you for your interest in Airborne Aviation Academy! Our counselor will contact you shortly.",
      variables: ["leadName"],
      isActive: true,
    },
    {
      orgId: org.id,
      name: "Lead Assigned Counselor Email",
      event: "LEAD_ASSIGNED" as const,
      channel: "EMAIL" as const,
      subject: "New Lead Assigned: {{leadName}}",
      body: "Dear {{counselorName}},\n\nA new lead has been assigned to you:\n\nName: {{leadName}}\nPhone: {{leadPhone}}\nCourse Interest: {{courseInterest}}\n\nPlease follow up within 24 hours.\n\nAirborne Aviation Academy",
      variables: ["counselorName", "leadName", "leadPhone", "courseInterest"],
      isActive: true,
    },
    {
      orgId: org.id,
      name: "Lead Status Changed Email",
      event: "LEAD_STATUS_CHANGED" as const,
      channel: "EMAIL" as const,
      subject: "Lead Status Updated: {{leadName}}",
      body: "The lead {{leadName}} has been updated from {{oldStatus}} to {{newStatus}}.",
      variables: ["leadName", "oldStatus", "newStatus"],
      isActive: true,
    },
  ];

  for (const template of templates) {
    await prisma.notificationTemplate.upsert({
      where: { orgId_event_channel: { orgId: org.id, event: template.event, channel: template.channel } },
      update: {},
      create: template,
    });
  }

  console.log(`✅ Notification templates: ${templates.length} created`);

  // ─── Section 5 demo data (meeting / automation / delivery log) ─────────────
  // A scheduled meeting on a known lead so the Meetings page has a row, a
  // lead-created automation so the Automation/Workflows page is populated, and
  // a SENT delivery log so the timeline/delivery-log views have a record.
  const sec5Lead = await prisma.lead.findUnique({ where: { id: leadB } });
  const sec5Counselor = createdUsers.find((u) => u.role === "ADMISSIONS_COUNSELOR");
  if (sec5Lead && sec5Counselor) {
    const meetingDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const existingMeeting = await prisma.leadActivity.findFirst({
      where: { orgId: org.id, leadId: sec5Lead.id, activityType: "MEETING", metadata: { path: ["demo"], equals: "section5" } },
    });
    if (!existingMeeting) {
      await prisma.leadActivity.create({
        data: {
          orgId: org.id,
          leadId: sec5Lead.id,
          activityType: "MEETING",
          title: `Counseling Session — ${sec5Lead.name}`,
          notes: "In-person counseling & campus tour (demo record).",
          dueAt: meetingDate,
          performedBy: sec5Counselor.id,
          metadata: { source: "demo", demo: "section5" },
        },
      });
    }

    await prisma.workflow.upsert({
      where: { orgId_code: { orgId: org.id, code: "new-lead-welcome" } },
      update: {},
      create: {
        orgId: org.id,
        name: "New Lead Welcome",
        code: "new-lead-welcome",
        description: "Send a WhatsApp welcome to every new lead (demo automation).",
        triggerEvent: "LEAD_CREATED",
        triggerConditions: { field: "source", op: "eq", value: "FACEBOOK_ADS" },
        steps: [
          {
            name: "Welcome on WhatsApp",
            type: "SEND_WHATSAPP",
            variables: { message: "Hi {{leadName}}, welcome to Airborne Aviation! A counsellor will call you shortly." },
          },
        ],
        isActive: true,
      },
    });
  }

  // Delivered WhatsApp delivery log for the timeline / delivery-log views.
  const welcomeTemplate = await prisma.notificationTemplate.findFirst({
    where: { orgId: org.id, channel: "WHATSAPP", event: "NEW_LEAD" },
  });
  const sec5Lead2 = sec5Lead ?? (await prisma.lead.findFirst({ where: { orgId: org.id } }));
  if (welcomeTemplate && sec5Lead2) {
    const demoLog = await prisma.notificationLog.findFirst({
      where: { orgId: org.id, status: "SENT", entityType: "lead", entityId: sec5Lead2.id, body: { contains: "demo" } },
    });
    if (!demoLog) {
      await prisma.notificationLog.create({
        data: {
          orgId: org.id,
          templateId: welcomeTemplate.id,
          event: "NEW_LEAD",
          channel: "WHATSAPP",
          recipient: sec5Lead2.phone,
          subject: null,
          body: "Hi {{leadName}} — demo delivery record for Section 5 verification.",
          status: "SENT",
          entityType: "lead",
          entityId: sec5Lead2.id,
          sentAt: new Date(Date.now() - 60 * 60 * 1000),
        },
      });
    }
  }

  console.log("✅ Section 5 demo data: meeting / automation / delivery log ensured");

  // ─── Sec 6 demo job (PUBLISHED, never closed) ───────────────────────────────
  // Ensures at least one PUBLISHED, open job exists so the public /api/public/jobs
  // feed and the section6 gate test are non-vacuous. Idempotent by orgId_slug.
  const demoJob = await prisma.job.upsert({
    where: { orgId_slug: { orgId: org.id, slug: "cpl-ground-school-mentor-2026" } },
    update: {},
    create: {
      orgId: org.id,
      title: "Flight Instructor — CPL Ground School (2026)",
      slug: "cpl-ground-school-mentor-2026",
      description: "Deliver DGCA CPL ground-school instruction to our Delhi campus cohort.",
      requirements: "CAA/DGCA instructor rating; 500+ hrs instruction experience preferred.",
      location: "New Delhi, India",
      isRemote: false,
      jobType: "full_time",
      salaryMin: 900000,
      salaryMax: 1400000,
      currency: "INR",
      experienceYears: 3,
      status: "PUBLISHED",
      publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      closesAt: null,
      tags: ["instructor", "cpl", "ground-school"],
      courseIds: [],
      seoTitle: "Flight Instructor — CPL Ground School at Airborne Aviation Academy",
      seoDesc: "Join Airborne Aviation Academy as a CPL Ground School instructor in New Delhi.",
      metadata: { source: "demo", demo: "section6" },
    },
  });
  console.log(`✅ Sec 6 job: ${demoJob.title} (${demoJob.slug}) PUBLISHED`);

  // ─── Feature Flags ──────────────────────────────────────────────────────────
  const flags = [
    { key: "lead_scoring_v2", value: { version: 2 }, description: "Next-gen lead scoring algorithm", isEnabled: false },
    { key: "whatsapp_bot", value: { provider: "wati" }, description: "Automated WhatsApp bot responses", isEnabled: false },
    { key: "ai_counselor_assist", value: { model: "gpt-4o" }, description: "AI-powered counselor suggestions", isEnabled: false },
    { key: "advanced_analytics", value: { provider: "internal" }, description: "Advanced analytics dashboard", isEnabled: true },
  ];

  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { orgId_key: { orgId: org.id, key: flag.key } },
      update: {},
      create: { orgId: org.id, ...flag },
    });
  }

  console.log(`✅ Feature flags: ${flags.length} created`);

  console.log("\n🎉 Seed completed successfully!\n");
  console.log("─".repeat(50));
  console.log("🔑 Default password for role users: set via SEED_DEFAULT_PASSWORD (random if unset)");
  console.log("🌐 Org slug: airborne-aviation");
  console.log("─".repeat(50));
  console.log("RC demo logins:");
  console.log("  ADMIN    admin@airborneaviation.in        / Admin@1234!");
  console.log("  TEACHER  demo.teacher@airborneaviation.in / DemoTeacher1!");
  console.log("  STUDENT  demo.student@airborneaviation.in / DemoStudent1!");
  console.log("─".repeat(50));
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
