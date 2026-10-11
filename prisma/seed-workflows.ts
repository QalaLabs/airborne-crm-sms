import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Seeds demo workflow configurations for the Interconnect OS engine.
// Idempotent: upserts on (orgId, code). Safe to run repeatedly.

async function main() {
  console.log("🌱 Seeding workflows...\n");

  const org = await prisma.organization.findUnique({ where: { slug: "airborne-aviation" } });
  if (!org) {
    throw new Error("Organization 'airborne-aviation' not found — run `npm run db:seed` first.");
  }

  // ─── 1. New lead welcome + counselor task ──────────────────────────────────
  await prisma.workflow.upsert({
    where: { orgId_code: { orgId: org.id, code: "new-lead-welcome" } },
    update: {},
    create: {
      orgId: org.id,
      name: "New Lead Welcome Sequence",
      code: "new-lead-welcome",
      description:
        "WhatsApp welcome on lead creation, a follow-up task for the assigned counselor, and a next-day nudge if the lead is still NEW.",
      triggerEvent: "LEAD_CREATED",
      triggerConditions: {},
      isActive: true,
      steps: [
        {
          name: "Welcome on WhatsApp",
          type: "SEND_WHATSAPP",
          variables: { leadName: "{{leadName}}", courseInterest: "{{courseInterest}}" },
        },
        {
          name: "Task for counselor",
          type: "CREATE_TASK",
          title: "Call {{leadName}} — new enquiry",
          notes: "Contact within working hours. Source: {{source}}.",
          dueInHours: 4,
        },
        { name: "Wait one day", type: "WAIT", duration: { days: 1 } },
        {
          name: "Still untouched?",
          type: "CONDITION",
          condition: { field: "status", op: "eq", value: "NEW" },
          then: [
            {
              name: "Email nudge to lead",
              type: "SEND_EMAIL",
              event: "WORKFLOW_TRIGGERED",
              variables: { message: "Hi {{leadName}}, shall we continue your aviation journey?" },
            },
          ],
          else: [],
        },
      ] as unknown as object[],
    },
  });
  console.log("✅ Workflow: new-lead-welcome");

  // ─── 2. Payment receipt + cross-sell tag ───────────────────────────────────
  await prisma.workflow.upsert({
    where: { orgId_code: { orgId: org.id, code: "payment-received-flow" } },
    update: {},
    create: {
      orgId: org.id,
      name: "Payment Received Flow",
      code: "payment-received-flow",
      description: "Thank-you email on every successful payment and a payer tag for segmentation.",
      triggerEvent: "PAYMENT_RECEIVED",
      triggerConditions: {},
      isActive: true,
      steps: [
        {
          name: "Receipt thanks email",
          type: "SEND_EMAIL",
          event: "PAYMENT_SUCCESS",
          variables: { amount: "{{amount}}", receiptNo: "{{receiptNo}}" },
        },
        { name: "Tag as paying customer", type: "ADD_TAG", tag: "payer" },
      ] as unknown as object[],
    },
  });
  console.log("✅ Workflow: payment-received-flow");

  // ─── 3. WhatsApp opt-out kill switch ───────────────────────────────────────
  await prisma.workflow.upsert({
    where: { orgId_code: { orgId: org.id, code: "opt-out-kill-switch" } },
    update: {},
    create: {
      orgId: org.id,
      name: "Opt-out Kill Switch",
      code: "opt-out-kill-switch",
      description:
        "When a contact opts out on WhatsApp, stop every active automation touching that entity immediately.",
      triggerEvent: "WHATSAPP_OPTED_OUT",
      triggerConditions: {},
      isActive: true,
      steps: [
        {
          name: "Stop all automations for this entity",
          type: "STOP_WORKFLOW",
          reason: "Contact opted out via WhatsApp",
          stopAllForEntity: true,
        },
      ] as unknown as object[],
    },
  });
  console.log("✅ Workflow: opt-out-kill-switch");

  // ─── 4. WhatsApp 21-day nurture sequence ───────────────────────────────────
  //
  // Built entirely on engine primitives: SEND_WHATSAPP steps carry their copy
  // through a pass-through template (body = "{{message}}"), WAIT steps provide
  // the cadence, and CONDITION guards re-check a FRESH lead snapshot before
  // every send — enrolled or opted-out leads stop the run immediately.

  await prisma.notificationTemplate.upsert({
    where: {
      orgId_event_channel: { orgId: org.id, event: "WORKFLOW_TRIGGERED", channel: "WHATSAPP" },
    },
    update: {},
    create: {
      orgId: org.id,
      event: "WORKFLOW_TRIGGERED",
      channel: "WHATSAPP",
      name: "Workflow WhatsApp pass-through",
      body: "{{message}}",
      variables: ["message"],
      isActive: true,
    },
  });
  console.log("✅ Template: WORKFLOW_TRIGGERED / WHATSAPP (pass-through)");

  const nurtureGuards = [
    {
      name: "Stop if enrolled",
      type: "CONDITION",
      condition: { field: "status", op: "in", value: ["ENROLLED"] },
      then: [{ type: "STOP_WORKFLOW", reason: "Lead enrolled during nurture sequence" }],
      else: [],
    },
    {
      name: "Stop if opted out",
      type: "CONDITION",
      condition: { field: "whatsappOptOut", op: "eq", value: true },
      then: [{ type: "STOP_WORKFLOW", reason: "Contact opted out of WhatsApp" }],
      else: [],
    },
  ];

  function touch(waitDays: number, day: number, message: string): object[] {
    return [
      { name: `Wait ${waitDays} day${waitDays === 1 ? "" : "s"}`, type: "WAIT", duration: { days: waitDays } },
      ...nurtureGuards,
      { name: `Day ${day} message`, type: "SEND_WHATSAPP", variables: { message } },
    ];
  }

  await prisma.workflow.upsert({
    where: { orgId_code: { orgId: org.id, code: "seq-nurture-21d" } },
    update: {},
    create: {
      orgId: org.id,
      name: "WhatsApp 21-Day Nurture Sequence",
      code: "seq-nurture-21d",
      description:
        "Eight WhatsApp touchpoints over 21 days for every new lead (Day 0/3/5/7/10/14/18/21). Stops automatically when the lead enrolls, opts out, or goes silent past the final call.",
      triggerEvent: "LEAD_CREATED",
      triggerConditions: {},
      isActive: true,
      steps: [
        {
          name: "Day 0 message",
          type: "SEND_WHATSAPP",
          variables: {
            message:
              "Hi {{leadName}}, welcome to Airborne Aviation! You asked about {{courseInterest}} — your journey starts here. A counsellor will call you shortly to plan your path from classroom to cockpit.",
          },
        },
        ...touch(
          2,
          3,
          "Hi {{leadName}}, quick hello from Airborne Aviation. Why students choose us: DGCA-aligned ground school, real hangar exposure and small batches with personal attention. Reply here and we will answer any question.",
        ),
        ...touch(
          2,
          5,
          "Hi {{leadName}}, did you know our graduates fly with leading airlines across India and abroad? Training quality decides your career. Come see a live class at our campus this week — reply VISIT and we will book you in.",
        ),
        ...touch(
          2,
          7,
          "Hi {{leadName}}, investing in your pilot career should be simple. Airborne offers flexible fee plans and EMI options for {{courseInterest}}. Want the full fee breakdown? Just reply FEES.",
        ),
        ...touch(
          3,
          10,
          "Hi {{leadName}}, meet Rohan — he started exactly where you are, worried about exams and costs. Eighteen months later he holds a CPL and flies commercially. Your story can be next. Shall we plan your batch?",
        ),
        ...touch(
          4,
          14,
          "Hi {{leadName}}, seats for the upcoming {{courseInterest}} batch are filling fast. Early enrollments get priority scheduling for ground school. Lock your seat before the batch closes — reply SEAT.",
        ),
        ...touch(
          4,
          18,
          "Hi {{leadName}}, it has been a while. If timing, fees or family questions are holding you back, talk to your counsellor — no pressure, just answers. Reply CALL with a good time.",
        ),
        ...touch(
          3,
          21,
          "Hi {{leadName}}, this is our last note for now. Whenever you are ready to start your aviation journey, we are one message away. Blue skies from all of us at Airborne Aviation!",
        ),
        {
          name: "Still unconverted after 21 days?",
          type: "CONDITION",
          condition: { field: "status", op: "notIn", value: ["ENROLLED"] },
          then: [
            {
              type: "CREATE_TASK",
              title: "Nurture ended — call {{leadName}} personally",
              notes: "The 21-day WhatsApp sequence finished without conversion. Personal follow-up recommended.",
              dueInDays: 1,
            },
          ],
          else: [],
        },
      ] as unknown as object[],
    },
  });
  console.log("✅ Workflow: seq-nurture-21d");

  // ─── 5. LMS course welcome (student lifecycle) ─────────────────────────────
  //
  // Fires when a student is enrolled into a batch (canonical course.enrolled
  // event emitted by LmsOpsService.setBatchMembers). Runs against the STUDENT
  // entity — the student snapshot carries phone/firstName/studentCode, and the
  // SEND_WHATSAPP action inherits WhatsApp opt-out from the linked lead.

  await prisma.workflow.upsert({
    where: { orgId_code: { orgId: org.id, code: "lms-course-welcome" } },
    update: {},
    create: {
      orgId: org.id,
      name: "LMS Course Welcome",
      code: "lms-course-welcome",
      description:
        "WhatsApp welcome with course, batch and student-portal pointers when a student is enrolled into a batch.",
      triggerEvent: "COURSE_ENROLLED",
      triggerConditions: {},
      isActive: true,
      steps: [
        {
          name: "Welcome the student on WhatsApp",
          type: "SEND_WHATSAPP",
          variables: {
            message:
              "Hi {{firstName}}, you are enrolled in {{event.courseName}} (batch {{event.batchName}}) at Airborne Aviation. Your student ID is {{studentCode}}. Course materials and your timetable are live in the student portal — reply here if you need help getting started.",
          },
        },
        {
          name: "Task for counselor on linked lead",
          type: "CREATE_TASK",
          title: "{{firstName}} enrolled in {{event.courseName}}",
          notes: "Student was added to batch {{event.batchName}}. Confirm portal access and orientation details.",
          dueInDays: 1,
        },
      ] as unknown as object[],
    },
  });
  console.log("✅ Workflow: lms-course-welcome");

  console.log("\n🌱 Workflow seed complete.");
}

main()
  .catch((err) => {
    console.error("❌ Workflow seed failed", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
