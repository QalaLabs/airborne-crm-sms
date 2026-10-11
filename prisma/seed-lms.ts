/**
 * AIRBORNE AVIATION — LMS DEMO SEED
 * ==========================================================================
 * Demo credentials (org slug: airborne-aviation):
 *   ADMIN:   admin@airborneaviation.in        / Admin@1234!
 *   TEACHER: demo.teacher@airborneaviation.in / DemoTeacher1!
 *   STUDENT: demo.student@airborneaviation.in / DemoStudent1!
 *
 * Run: npm run db:seed:lms   (from admin/ directory)
 *
 * Idempotent: uses upsert by slug/email — safe to re-run.
 * ==========================================================================
 */

import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding LMS demo data…");

  // ── 1. Organisation ──────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: "airborne-aviation" },
    update: {},
    create: {
      name: "Airborne Aviation Academy",
      slug: "airborne-aviation",
      plan: "PROFESSIONAL",
      isActive: true,
      settings: {},
      featureFlags: {},
    },
  });
  console.log(`✅ Org: ${org.name} (${org.id})`);

  // ── 2. Admin User (seed only if not exists) ───────────────────────────────
  const adminEmail = "admin@airborneaviation.in";
  const existingAdmin = await prisma.user.findFirst({ where: { email: adminEmail, orgId: org.id } });
  let adminUser = existingAdmin;
  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: {
        orgId: org.id,
        name: "Airborne Admin",
        email: adminEmail,
        passwordHash: await hash("Admin@1234!"),
        role: "ADMIN",
        isActive: true,
        emailVerified: new Date(),
      },
    });
    console.log(`✅ Admin user created: ${adminEmail}`);
  } else {
    console.log(`ℹ️  Admin user exists: ${adminEmail}`);
  }

  // ── 3. Demo Student + portal User ─────────────────────────────────────────
  const demoEmail = "demo.student@airborneaviation.in";
  const demoPassword = "DemoStudent1!";

  let demoPortalUser = await prisma.user.findFirst({ where: { email: demoEmail, orgId: org.id } });
  if (!demoPortalUser) {
    demoPortalUser = await prisma.user.create({
      data: {
        orgId: org.id,
        name: "Arjun Sharma",
        email: demoEmail,
        passwordHash: await hash(demoPassword),
        role: "STUDENT",
        isActive: true,
        emailVerified: new Date(),
      },
    });
    console.log(`✅ Demo portal user created: ${demoEmail}`);
  } else {
    console.log(`ℹ️  Demo portal user exists: ${demoEmail}`);
  }

  // CRM Student linked to portal user
  let demoStudent = await prisma.student.findFirst({
    where: { orgId: org.id, email: demoEmail },
  });
  if (!demoStudent) {
    demoStudent = await prisma.student.create({
      data: {
        orgId: org.id,
        studentCode: "ABC-2024-0001",
        firstName: "Arjun",
        lastName: "Sharma",
        email: demoEmail,
        phone: "+919876543210",
        status: "ACTIVE",
        userId: demoPortalUser.id,
      },
    });
    console.log(`✅ CRM Student created: ${demoStudent.studentCode}`);
  } else {
    if (!demoStudent.userId) {
      await prisma.student.update({ where: { id: demoStudent.id }, data: { userId: demoPortalUser.id } });
    }
    console.log(`ℹ️  CRM Student exists: ${demoStudent.studentCode}`);
  }

  // ── 3b. Demo Teacher ──────────────────────────────────────────────────────
  const teacherEmail = "demo.teacher@airborneaviation.in";
  const teacherPassword = "DemoTeacher1!";
  let demoTeacher = await prisma.user.findFirst({ where: { email: teacherEmail, orgId: org.id } });
  if (!demoTeacher) {
    demoTeacher = await prisma.user.create({
      data: {
        orgId: org.id,
        name: "Demo Teacher",
        email: teacherEmail,
        passwordHash: await hash(teacherPassword),
        role: "TEACHER",
        isActive: true,
        emailVerified: new Date(),
      },
    });
    console.log(`✅ Demo teacher created: ${teacherEmail}`);
  } else {
    if (demoTeacher.role !== "TEACHER" || !demoTeacher.isActive) {
      await prisma.user.update({
        where: { id: demoTeacher.id },
        data: { role: "TEACHER", isActive: true, deletedAt: null },
      });
    }
    console.log(`ℹ️  Demo teacher exists: ${teacherEmail}`);
  }

  // ── 4. LMS Course ────────────────────────────────────────────────────────
  const courseSlug = "dgca-ground-school-navigation-fundamentals";
  let lmsCourse = await prisma.lmsCourse.findFirst({ where: { orgId: org.id, slug: courseSlug } });
  if (!lmsCourse) {
    lmsCourse = await prisma.lmsCourse.create({
      data: {
        orgId: org.id,
        slug: courseSlug,
        title: "DGCA Ground School - Navigation Fundamentals",
        description:
          "A comprehensive DGCA-aligned ground school course covering Air Navigation, Meteorology, Air Law and ATC procedures. Designed for CPL and PPL aspirants preparing for DGCA written examinations.",
        isPublished: true,
        status: "PUBLISHED",
      },
    });
    console.log(`✅ LMS Course created: ${lmsCourse.title}`);
  } else {
    console.log(`ℹ️  LMS Course exists: ${lmsCourse.title}`);
  }

  // ── 5. Curriculum Tree ───────────────────────────────────────────────────

  // Stage 1: Air Navigation
  let stage1 = await prisma.lmsStage.findFirst({ where: { courseId: lmsCourse.id, title: "Stage 1: Air Navigation" } });
  if (!stage1) {
    stage1 = await prisma.lmsStage.create({ data: { courseId: lmsCourse.id, title: "Stage 1: Air Navigation", order: 0 } });
  }

  // Stage 2: Air Law & ATC
  let stage2 = await prisma.lmsStage.findFirst({ where: { courseId: lmsCourse.id, title: "Stage 2: Air Law & ATC" } });
  if (!stage2) {
    stage2 = await prisma.lmsStage.create({ data: { courseId: lmsCourse.id, title: "Stage 2: Air Law & ATC", order: 1 } });
  }

  // ─ Module 1: Charts & Instruments
  let mod1 = await prisma.lmsModule.findFirst({ where: { stageId: stage1.id, title: "Charts & Instruments" } });
  if (!mod1) {
    mod1 = await prisma.lmsModule.create({
      data: { stageId: stage1.id, title: "Charts & Instruments", order: 0, passPercent: 70, maxAttempts: 3 },
    });
  }

  // ─ Module 2: Dead Reckoning & Radio Navigation
  let mod2 = await prisma.lmsModule.findFirst({ where: { stageId: stage1.id, title: "Dead Reckoning & Radio Navigation" } });
  if (!mod2) {
    mod2 = await prisma.lmsModule.create({
      data: { stageId: stage1.id, title: "Dead Reckoning & Radio Navigation", order: 1, passPercent: 70, maxAttempts: 3 },
    });
  }

  // ─ Module 3: DGCA Air Law Essentials
  let mod3 = await prisma.lmsModule.findFirst({ where: { stageId: stage2.id, title: "DGCA Air Law Essentials" } });
  if (!mod3) {
    mod3 = await prisma.lmsModule.create({
      data: { stageId: stage2.id, title: "DGCA Air Law Essentials", order: 0, passPercent: 75, maxAttempts: 3 },
    });
  }

  // ─ Module 4: ATC Procedures & Phraseology
  let mod4 = await prisma.lmsModule.findFirst({ where: { stageId: stage2.id, title: "ATC Procedures & Phraseology" } });
  if (!mod4) {
    mod4 = await prisma.lmsModule.create({
      data: { stageId: stage2.id, title: "ATC Procedures & Phraseology", order: 1, passPercent: 70, maxAttempts: 3 },
    });
  }

  // ─ Chapters & Topics for Module 1
  const seedChapterTopics = async (
    moduleId: string,
    chapTitle: string,
    topics: Array<{ title: string; contents: Array<{ title: string; type: "PDF" | "VIDEO" | "NOTES"; url: string }> }>,
    chapterOrder: number,
  ) => {
    let ch = await prisma.lmsChapter.findFirst({ where: { moduleId, title: chapTitle } });
    if (!ch) ch = await prisma.lmsChapter.create({ data: { moduleId, title: chapTitle, order: chapterOrder } });

    for (let i = 0; i < topics.length; i++) {
      const t = topics[i]!;
      let topic = await prisma.lmsTopic.findFirst({ where: { chapterId: ch.id, title: t.title } });
      if (!topic) topic = await prisma.lmsTopic.create({ data: { chapterId: ch.id, title: t.title, order: i } });

      for (let j = 0; j < t.contents.length; j++) {
        const c = t.contents[j]!;
        const exists = await prisma.lmsContent.findFirst({ where: { topicId: topic.id, title: c.title } });
        if (!exists) {
          await prisma.lmsContent.create({ data: { topicId: topic.id, title: c.title, type: c.type, url: c.url, order: j } });
        }
      }
    }
    return ch;
  };

  // Module 1 content
  await seedChapterTopics(mod1.id, "Chapter 1: Aeronautical Charts", [
    {
      title: "Introduction to ICAO Charts",
      contents: [
        {
          title: "ICAO Chart Types - Lecture Notes",
          type: "PDF",
          url: "https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf-sample.pdf",
        },
      ],
    },
    {
      title: "Reading Topographic Charts",
      contents: [
        {
          title: "Topographic Features Video",
          type: "VIDEO",
          url: "https://www.w3schools.com/html/mov_bbb.mp4",
        },
        {
          title: "Chart Reading Exercises",
          type: "PDF",
          url: "https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf-sample.pdf",
        },
      ],
    },
  ], 0);

  await seedChapterTopics(mod1.id, "Chapter 2: Navigation Instruments", [
    {
      title: "Altimeter & VSI",
      contents: [
        {
          title: "Altimeter Errors & Corrections",
          type: "NOTES",
          url: "https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf-sample.pdf",
        },
      ],
    },
    {
      title: "Directional Gyro & Compass",
      contents: [
        {
          title: "DI & Compass Alignment - Video",
          type: "VIDEO",
          url: "https://www.w3schools.com/html/mov_bbb.mp4",
        },
      ],
    },
  ], 1);

  // Module 2 content
  await seedChapterTopics(mod2.id, "Chapter 1: Dead Reckoning", [
    {
      title: "DR Position Fixing",
      contents: [
        { title: "DR Navigation Notes", type: "PDF", url: "https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf-sample.pdf" },
      ],
    },
    {
      title: "Wind Triangle Calculations",
      contents: [
        { title: "Wind Correction Angle Video", type: "VIDEO", url: "https://www.w3schools.com/html/mov_bbb.mp4" },
      ],
    },
  ], 0);

  await seedChapterTopics(mod2.id, "Chapter 2: Radio Navigation Aids", [
    {
      title: "VOR & DME",
      contents: [
        { title: "VOR Principles PDF", type: "PDF", url: "https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf-sample.pdf" },
      ],
    },
    {
      title: "ILS & Approaches",
      contents: [
        { title: "ILS Approach Video", type: "VIDEO", url: "https://www.w3schools.com/html/mov_bbb.mp4" },
        { title: "ILS Notes", type: "NOTES", url: "https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf-sample.pdf" },
      ],
    },
  ], 1);

  // Module 3 content
  await seedChapterTopics(mod3.id, "Chapter 1: DGCA Regulations", [
    {
      title: "Aircraft Airworthiness Rules",
      contents: [
        { title: "CAR Section 2 - Airworthiness", type: "PDF", url: "https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf-sample.pdf" },
      ],
    },
    {
      title: "Pilot Licensing Requirements",
      contents: [
        { title: "Licensing Overview Video", type: "VIDEO", url: "https://www.w3schools.com/html/mov_bbb.mp4" },
      ],
    },
  ], 0);

  // Module 4 content
  await seedChapterTopics(mod4.id, "Chapter 1: ATC Communications", [
    {
      title: "Standard Phraseology",
      contents: [
        { title: "ICAO Phraseology Guide", type: "PDF", url: "https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf-sample.pdf" },
        { title: "Phraseology Examples Audio/Video", type: "VIDEO", url: "https://www.w3schools.com/html/mov_bbb.mp4" },
      ],
    },
    {
      title: "Departure & Arrival Procedures",
      contents: [
        { title: "SID & STAR Notes", type: "NOTES", url: "https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf-sample.pdf" },
      ],
    },
  ], 0);

  console.log("✅ Curriculum tree seeded");

  // ── 6. MCQ Questions ──────────────────────────────────────────────────────

  const seedQuestions = async (
    moduleId: string,
    questions: Array<{
      stem: string;
      options: Array<{ id: string; text: string }>;
      correctOptionId: string;
      points?: number;
    }>,
  ) => {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!;
      const exists = await prisma.lmsQuestion.findFirst({ where: { moduleId, stem: q.stem } });
      if (!exists) {
        await prisma.lmsQuestion.create({
          data: {
            moduleId,
            stem: q.stem,
            options: q.options,
            correctOptionId: q.correctOptionId,
            order: i,
            points: q.points ?? 1,
          },
        });
      }
    }
  };

  // Module 1 questions — Charts & Instruments
  await seedQuestions(mod1.id, [
    {
      stem: "Which chart scale is most commonly used for en-route navigation in India?",
      options: [
        { id: "a", text: "1:500,000" },
        { id: "b", text: "1:1,000,000" },
        { id: "c", text: "1:250,000" },
        { id: "d", text: "1:2,000,000" },
      ],
      correctOptionId: "b",
    },
    {
      stem: "An altimeter set to QNH reads altitude above:",
      options: [
        { id: "a", text: "The aerodrome elevation" },
        { id: "b", text: "Mean sea level" },
        { id: "c", text: "Pressure altitude" },
        { id: "d", text: "The lowest terrain within 25 NM" },
      ],
      correctOptionId: "b",
    },
    {
      stem: "A Directional Gyro (DI) must be aligned with the magnetic compass every:",
      options: [
        { id: "a", text: "5 minutes" },
        { id: "b", text: "10–15 minutes" },
        { id: "c", text: "30 minutes" },
        { id: "d", text: "1 hour" },
      ],
      correctOptionId: "b",
    },
    {
      stem: "What is the main error of the magnetic compass during a turn?",
      options: [
        { id: "a", text: "Oscillation error" },
        { id: "b", text: "Dip error (northerly turning error)" },
        { id: "c", text: "Parallax error" },
        { id: "d", text: "Gyroscopic precession" },
      ],
      correctOptionId: "b",
    },
    {
      stem: "ICAO Annex 4 covers:",
      options: [
        { id: "a", text: "Air Traffic Services" },
        { id: "b", text: "Aeronautical Charts" },
        { id: "c", text: "Meteorology" },
        { id: "d", text: "Aircraft Nationality Marks" },
      ],
      correctOptionId: "b",
    },
  ]);

  // Module 2 questions — Dead Reckoning
  await seedQuestions(mod2.id, [
    {
      stem: "During Dead Reckoning, the Wind Correction Angle (WCA) is applied to the:",
      options: [
        { id: "a", text: "True Track to obtain True Heading" },
        { id: "b", text: "Magnetic Heading to obtain True Track" },
        { id: "c", text: "Ground speed to obtain TAS" },
        { id: "d", text: "Variation to obtain deviation" },
      ],
      correctOptionId: "a",
    },
    {
      stem: "A VOR station transmits a signal that provides:",
      options: [
        { id: "a", text: "Distance and bearing from the station" },
        { id: "b", text: "Magnetic bearing from the station" },
        { id: "c", text: "True bearing to the destination" },
        { id: "d", text: "Distance from the aircraft to a waypoint" },
      ],
      correctOptionId: "b",
    },
    {
      stem: "DME measures the distance between the aircraft and the ground station in:",
      options: [
        { id: "a", text: "Horizontal miles" },
        { id: "b", text: "Slant range nautical miles" },
        { id: "c", text: "Great circle nautical miles" },
        { id: "d", text: "Statute miles" },
      ],
      correctOptionId: "b",
    },
    {
      stem: "The ILS Localizer provides guidance in the:",
      options: [
        { id: "a", text: "Vertical plane" },
        { id: "b", text: "Horizontal plane" },
        { id: "c", text: "Both horizontal and vertical" },
        { id: "d", text: "Distance only" },
      ],
      correctOptionId: "b",
    },
    {
      stem: "When using VOR, a CDI deflection of full-scale indicates the aircraft is:",
      options: [
        { id: "a", text: "Exactly on the selected radial" },
        { id: "b", text: "10° or more from the selected radial" },
        { id: "c", text: "5° from the selected radial" },
        { id: "d", text: "2° from the selected radial" },
      ],
      correctOptionId: "b",
    },
  ]);

  // Module 3 questions — Air Law
  await seedQuestions(mod3.id, [
    {
      stem: "Under DGCA regulations, the minimum age to hold a Commercial Pilot Licence (CPL) is:",
      options: [
        { id: "a", text: "16 years" },
        { id: "b", text: "17 years" },
        { id: "c", text: "18 years" },
        { id: "d", text: "21 years" },
      ],
      correctOptionId: "c",
    },
    {
      stem: "An aircraft Certificate of Airworthiness (CofA) is issued under ICAO Annex:",
      options: [
        { id: "a", text: "Annex 1" },
        { id: "b", text: "Annex 6" },
        { id: "c", text: "Annex 8" },
        { id: "d", text: "Annex 2" },
      ],
      correctOptionId: "c",
    },
    {
      stem: "The right of way rule in ICAO Annex 2 states that a power-driven aircraft shall give way to:",
      options: [
        { id: "a", text: "All other power-driven aircraft" },
        { id: "b", text: "Airships, gliders and balloons" },
        { id: "c", text: "Only balloons" },
        { id: "d", text: "Helicopters" },
      ],
      correctOptionId: "b",
    },
    {
      stem: "A NOTAM (Notice to Air Missions) is classified as 'Class II' when its validity is:",
      options: [
        { id: "a", text: "Up to 3 months" },
        { id: "b", text: "Up to 1 month" },
        { id: "c", text: "Permanent" },
        { id: "d", text: "Up to 48 hours" },
      ],
      correctOptionId: "a",
    },
    {
      stem: "The cruising level for IFR flights in India at magnetic tracks 000°–179° above the transition altitude is:",
      options: [
        { id: "a", text: "Odd thousands of feet" },
        { id: "b", text: "Even thousands of feet" },
        { id: "c", text: "Odd thousands + 500 feet" },
        { id: "d", text: "Even thousands + 500 feet" },
      ],
      correctOptionId: "c",
    },
  ]);

  // Module 4 questions — ATC
  await seedQuestions(mod4.id, [
    {
      stem: "The word 'WILCO' means:",
      options: [
        { id: "a", text: "I have received your message" },
        { id: "b", text: "I have received and understood your message and will comply" },
        { id: "c", text: "Stand by" },
        { id: "d", text: "Say again" },
      ],
      correctOptionId: "b",
    },
    {
      stem: "A Standard Instrument Departure (SID) is a published ATC procedure that:",
      options: [
        { id: "a", text: "Provides radar coverage to aircraft" },
        { id: "b", text: "Simplifies clearance delivery and reduces R/T" },
        { id: "c", text: "Replaces the IFR flight plan" },
        { id: "d", text: "Is used only for VFR departures" },
      ],
      correctOptionId: "b",
    },
    {
      stem: "What does the phrase 'EXPEDITE' mean in ATC communications?",
      options: [
        { id: "a", text: "Slow down" },
        { id: "b", text: "Maintain present heading" },
        { id: "c", text: "Proceed without delay" },
        { id: "d", text: "Altitude to maintain" },
      ],
      correctOptionId: "c",
    },
    {
      stem: "Emergency frequency worldwide for distress and urgency is:",
      options: [
        { id: "a", text: "118.0 MHz" },
        { id: "b", text: "121.5 MHz" },
        { id: "c", text: "123.45 MHz" },
        { id: "d", text: "122.8 MHz" },
      ],
      correctOptionId: "b",
    },
    {
      stem: "A STAR (Standard Terminal Arrival Route) connects:",
      options: [
        { id: "a", text: "Runway to the en-route phase" },
        { id: "b", text: "The en-route structure to the initial approach fix (IAF)" },
        { id: "c", text: "The IAF to the final approach fix (FAF)" },
        { id: "d", text: "Departure airport to en-route" },
      ],
      correctOptionId: "b",
    },
  ]);

  console.log("✅ MCQ questions seeded");

  // ── 7. Enrollment ─────────────────────────────────────────────────────────
  const existingEnrollment = await prisma.lmsEnrollment.findFirst({
    where: { studentId: demoStudent.id, courseId: lmsCourse.id },
  });
  if (!existingEnrollment) {
    await prisma.lmsEnrollment.create({
      data: { orgId: org.id, studentId: demoStudent.id, courseId: lmsCourse.id, status: "ACTIVE" },
    });
    console.log("✅ Demo student enrolled in LMS course");
  } else {
    console.log("ℹ️  Enrollment already exists");
  }

  // ── 8. Sample Progress ────────────────────────────────────────────────────
  // Mark some topics as completed for the demo student
  const allTopics = await prisma.lmsTopic.findMany({
    where: {
      chapter: {
        module: { stage: { courseId: lmsCourse.id } },
      },
    },
    take: 4,
    include: { chapter: { include: { module: { include: { stage: true } } } } },
  });

  for (const topic of allTopics) {
    await prisma.lmsStudentProgress.upsert({
      where: { studentId_topicId: { studentId: demoStudent.id, topicId: topic.id } },
      update: {},
      create: {
        studentId: demoStudent.id,
        userId: demoPortalUser.id,
        topicId: topic.id,
        completed: true,
        percent: 100,
        completedAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
      },
    });
  }
  console.log(`✅ Progress seeded for ${allTopics.length} topics`);

  // ── 9. Passed Assessment for Module 1 ────────────────────────────────────
  const existingAssessment = await prisma.lmsAssessment.findFirst({
    where: { studentId: demoStudent.id, moduleId: mod1.id },
  });
  if (!existingAssessment) {
    await prisma.lmsAssessment.create({
      data: {
        studentId: demoStudent.id,
        userId: demoPortalUser.id,
        moduleId: mod1.id,
        score: 80,
        status: "PASS",
        attempts: 1,
      },
    });
    // Also create a quiz attempt record
    await prisma.lmsQuizAttempt.create({
      data: {
        studentId: demoStudent.id,
        userId: demoPortalUser.id,
        moduleId: mod1.id,
        score: 80,
        maxScore: 100,
        passed: true,
        attemptNumber: 1,
        answers: {
          note: "seeded demo attempt",
        },
      },
    });
    console.log("✅ Demo assessment (Module 1 passed) seeded");
  } else {
    console.log("ℹ️  Assessment for Module 1 already exists");
  }

  // ── 10. Attendance sessions ───────────────────────────────────────────────
  const existingSession = await prisma.lmsAttendanceSession.findFirst({
    where: { courseId: lmsCourse.id, title: "Navigation Charts - Intro Class" },
  });
  if (!existingSession) {
    const session1 = await prisma.lmsAttendanceSession.create({
      data: {
        orgId: org.id,
        courseId: lmsCourse.id,
        title: "Navigation Charts - Intro Class",
        heldAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.lmsAttendanceRecord.create({
      data: {
        sessionId: session1.id,
        studentId: demoStudent.id,
        status: "PRESENT",
        markedBy: adminUser?.id ?? org.id,
      },
    });

    const session2 = await prisma.lmsAttendanceSession.create({
      data: {
        orgId: org.id,
        courseId: lmsCourse.id,
        title: "Instruments & Errors - Lecture 2",
        heldAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.lmsAttendanceRecord.create({
      data: {
        sessionId: session2.id,
        studentId: demoStudent.id,
        status: "PRESENT",
        markedBy: adminUser?.id ?? org.id,
      },
    });

    const session3 = await prisma.lmsAttendanceSession.create({
      data: {
        orgId: org.id,
        courseId: lmsCourse.id,
        title: "Dead Reckoning Workshop",
        heldAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.lmsAttendanceRecord.create({
      data: {
        sessionId: session3.id,
        studentId: demoStudent.id,
        status: "LATE",
        markedBy: adminUser?.id ?? org.id,
      },
    });
    console.log("✅ Attendance sessions seeded (3 sessions)");
  } else {
    console.log("ℹ️  Attendance sessions already exist");
  }

  // ── 11. ISSUED Certificate ────────────────────────────────────────────────
  const existingCert = await prisma.lmsCertificate.findFirst({
    where: { studentId: demoStudent.id, courseId: lmsCourse.id },
  });
  if (!existingCert) {
    await prisma.lmsCertificate.create({
      data: {
        orgId: org.id,
        studentId: demoStudent.id,
        courseId: lmsCourse.id,
        certificateNo: "ABC-NAV-2024-0001",
        verificationCode: "VERIFY-NAV-0001",
        title: "DGCA Ground School - Navigation Fundamentals - Certificate of Completion",
        status: "ISSUED",
        issuedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        issuedBy: adminUser?.id,
      },
    });
    console.log("✅ Certificate issued: ABC-NAV-2024-0001");
  } else {
    console.log("ℹ️  Certificate already exists");
  }

  // ── 12. Announcement ─────────────────────────────────────────────────────
  const existingAnnouncement = await prisma.lmsAnnouncement.findFirst({
    where: { orgId: org.id, title: "Welcome to DGCA Ground School!" },
  });
  if (!existingAnnouncement) {
    await prisma.lmsAnnouncement.create({
      data: {
        orgId: org.id,
        courseId: lmsCourse.id,
        title: "Welcome to DGCA Ground School!",
        body: "Dear students, welcome to the Navigation Fundamentals course. Please complete all module quizzes to unlock subsequent modules. Reach out on the AI assistant for any doubts. Best of luck with your DGCA preparation!",
        publishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        createdBy: adminUser?.id,
      },
    });

    await prisma.lmsAnnouncement.create({
      data: {
        orgId: org.id,
        courseId: lmsCourse.id,
        title: "Module 2 quiz is now live",
        body: "Dead Reckoning & Radio Navigation module quiz has been activated. You have 3 attempts with a 70% pass threshold. Good luck!",
        publishedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        createdBy: adminUser?.id,
      },
    });
    console.log("✅ Announcements seeded");
  } else {
    console.log("ℹ️  Announcements already exist");
  }

  // ── 13. Bookmark ─────────────────────────────────────────────────────────
  const firstTopics = await prisma.lmsTopic.findMany({
    where: { chapter: { module: { stage: { courseId: lmsCourse.id } } } },
    take: 2,
  });
  for (const topic of firstTopics) {
    await prisma.lmsBookmark.upsert({
      where: { studentId_topicId: { studentId: demoStudent.id, topicId: topic.id } },
      update: {},
      create: { studentId: demoStudent.id, topicId: topic.id },
    });
  }
  console.log("✅ Bookmarks seeded");

  console.log("\n🎉 LMS demo seed complete!\n");
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Org slug: airborne-aviation");
  console.log("  URL:      http://localhost:4000/login");
  console.log("───────────────────────────────────────────────────────");
  console.log("  ADMIN    admin@airborneaviation.in        / Admin@1234!");
  console.log("  TEACHER  demo.teacher@airborneaviation.in / DemoTeacher1!");
  console.log("  STUDENT  demo.student@airborneaviation.in / DemoStudent1!");
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Certificate verify code: VERIFY-NAV-0001");
  console.log("  Cert No:                 ABC-NAV-2024-0001");
  console.log("═══════════════════════════════════════════════════════\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
