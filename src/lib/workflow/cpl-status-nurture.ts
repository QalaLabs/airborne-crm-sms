import type { ConditionSpec, WorkflowStep } from "./types";

// ─── CPL status-triggered WhatsApp nurture (21 days) ─────────────────────────
//
// Entry: a lead is created at NEW status and the lead's course is Commercial
// Pilot License (Day 1 sends immediately). Runs through Interakt approved templates, grouped under one
// Interakt API campaign. Stops ONLY on WhatsApp opt-out or an exit status —
// a lead replying does not stop it.

export const CPL_NURTURE_WORKFLOW_CODE = "cpl-status-nurture-21d";
export const CPL_NURTURE_KILL_WORKFLOW_CODE = "cpl-status-nurture-kill";
export const CPL_NURTURE_ACTIVE_TAG = "cpl-nurture-active";
export const CPL_NURTURE_DONE_TAG = "cpl-nurture-21d-complete";

/** Statuses that end the nurture: enrolled, won, or lost (incl. all lost reasons). */
export const CPL_NURTURE_EXIT_STATUSES = [
  "APPLICATION_SUBMITTED",
  "CONVERTED",
  "WON",
  "LOST",
  "INCOMING_BARD",
  "OUT_OF_SERVICE",
  "NOT_AWARE",
  "NOT_CONTACTABLE",
  "LOCATION_OUT_OF_SCOPE",
  "LANGUAGE_BARRIER",
  "PRICE_HIGH",
  "JOINED_OTHERS",
  "NOT_ELIGIBLE",
  "INVALID_NUMBER",
  "TEST_LEAD",
  "NOT_INTERESTED",
  "REASON_NOT_SHARED",
  "JOB_SEEKER",
] as const;

/**
 * Course slugs allowed into the nurture: the CPL course and DGCA CPL Ground
 * Classes (the CRM classifies those as ground-school). Resolved by the CRM's
 * course classifier (lead snapshot `courseSlug`), so A320 simulator, airline preparation, cadet,
 * cabin crew, ATPL, PPL and combos like "CPL & Airline Preparation"
 * never enter. Extend this list deliberately if more courses should.
 */
export const CPL_NURTURE_COURSE_SLUGS = ["commercial-pilot-license-cpl", "ground-school"] as const;

const CPL_COURSE: ConditionSpec = {
  field: "courseSlug",
  op: "in",
  value: [...CPL_NURTURE_COURSE_SLUGS],
};

/** Trigger event: starts the moment a CPL lead is created at NEW status. */
export const CPL_NURTURE_TRIGGER_EVENT = "LEAD_CREATED" as const;

export const CPL_NURTURE_TRIGGER_CONDITIONS: ConditionSpec = {
  all: [
    { field: "status", op: "eq", value: "NEW" },
    CPL_COURSE,
    { field: "phone", op: "exists" },
    { field: "whatsappOptOut", op: "neq", value: true },
    { not: { field: "tags", op: "contains", value: CPL_NURTURE_ACTIVE_TAG } },
    { not: { field: "tags", op: "contains", value: CPL_NURTURE_DONE_TAG } },
  ],
};

export const CPL_NURTURE_KILL_TRIGGER_CONDITIONS: ConditionSpec = {
  field: "event.newStatus",
  op: "in",
  value: [...CPL_NURTURE_EXIT_STATUSES],
};

interface NurtureMessage {
  day: number;
  /** Days to wait after the previous message (0 for the first). */
  waitDays: number;
  templateName: string;
  /** Ordered Interakt {{1}} {{2}} … values. CONFIRM against each approved template. */
  bodyValues: string[];
}

export const CPL_NURTURE_MESSAGES: NurtureMessage[] = [
  { day: 1, waitDays: 0, templateName: "cpl_nurture_d1_welcome_brochure", bodyValues: ["{{name}}", "{{courseInterest}}"] },
  { day: 3, waitDays: 2, templateName: "cpl_nurture_d3_founder_video", bodyValues: ["{{name}}"] },
  { day: 5, waitDays: 2, templateName: "cpl_nurture_d5_success_story", bodyValues: ["{{name}}"] },
  { day: 7, waitDays: 2, templateName: "cpl_nurture_d7_fees_scholarship", bodyValues: ["{{name}}", "{{courseInterest}}"] },
  { day: 10, waitDays: 3, templateName: "cpl_nurture_d10_batch_urgency", bodyValues: ["{{name}}", "{{courseInterest}}"] },
  { day: 14, waitDays: 4, templateName: "cpl_nurture_d14_personal_followup", bodyValues: ["{{name}}", "Admissions Team", "{{courseInterest}}"] },
  { day: 18, waitDays: 4, templateName: "cpl_nurture_d18_final_reminder", bodyValues: ["{{name}}"] },
  { day: 21, waitDays: 3, templateName: "cpl_nurture_d21_lastchance_altcourse", bodyValues: ["{{name}}", "{{courseInterest}}", "Ground School Modular Training"] },
];

function exitGuard(day: number): WorkflowStep {
  return {
    name: `Exit check before Day ${day}`,
    type: "CONDITION",
    condition: {
      any: [
        { field: "status", op: "in", value: [...CPL_NURTURE_EXIT_STATUSES] },
        { field: "whatsappOptOut", op: "eq", value: true },
      ],
    },
    then: [
      { name: "Clear active tag", type: "REMOVE_TAG", tag: CPL_NURTURE_ACTIVE_TAG },
      { name: "Exit status or opt-out", type: "STOP_WORKFLOW", reason: "CPL nurture: exit status or opt-out" },
    ],
    else: [],
  };
}

export function buildCplNurtureSteps(providerCampaignId?: string): WorkflowStep[] {
  const steps: WorkflowStep[] = [{ name: "Mark nurture active", type: "ADD_TAG", tag: CPL_NURTURE_ACTIVE_TAG }];

  for (const msg of CPL_NURTURE_MESSAGES) {
    if (msg.waitDays > 0) {
      steps.push({
        name: `Wait ${msg.waitDays} days for Day ${msg.day}`,
        type: "WAIT",
        duration: { days: msg.waitDays },
      });
      steps.push(exitGuard(msg.day));
    }
    steps.push({
      name: `Day ${msg.day}`,
      type: "SEND_WHATSAPP",
      templateName: msg.templateName,
      bodyValues: msg.bodyValues,
      ...(providerCampaignId ? { providerCampaignId } : {}),
    });
    if (msg.day === 14) {
      steps.push({
        name: "Day 14 counselor call task",
        type: "CREATE_TASK",
        title: "Call {{name}} — Day 14 CPL follow-up",
        notes: "Lead is in the CPL nurture. Personal follow-up call.",
        dueInDays: 1,
      });
    }
  }

  steps.push({ name: "Mark nurture complete", type: "ADD_TAG", tag: CPL_NURTURE_DONE_TAG });
  steps.push({ name: "Clear active tag", type: "REMOVE_TAG", tag: CPL_NURTURE_ACTIVE_TAG });
  steps.push({
    name: "Day 21 counselor task",
    type: "CREATE_TASK",
    title: "Nurture ended for {{name}} — decide next step",
    notes: "21-day CPL WhatsApp nurture finished with no exit status.",
    dueInDays: 1,
  });
  return steps;
}

export function buildCplNurtureKillSteps(): WorkflowStep[] {
  return [
    { name: "Clear active tag", type: "REMOVE_TAG", tag: CPL_NURTURE_ACTIVE_TAG },
    {
      name: "Stop CPL nurture runs",
      type: "STOP_WORKFLOW",
      reason: "CPL nurture: lead reached an exit status",
      stopAllForEntity: true,
      onlyWorkflowCode: CPL_NURTURE_WORKFLOW_CODE,
    },
  ];
}
