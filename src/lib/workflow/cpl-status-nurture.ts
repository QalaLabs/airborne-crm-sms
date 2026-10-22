import type { ConditionSpec, WorkflowStep } from "./types";

// ─── CPL status-triggered WhatsApp nurture (21 days) ─────────────────────────
//
// Entry: a lead is created at NEW status and the lead's course is Commercial
// Pilot License (Day 1 sends immediately). Runs through Interakt approved templates,
// grouped under specific Interakt API campaigns. Stops on WhatsApp opt-out or an exit status.

export const CPL_NURTURE_WORKFLOW_CODE = "cpl-status-nurture-21d";
export const CPL_NURTURE_KILL_WORKFLOW_CODE = "cpl-status-nurture-kill";
export const CPL_NURTURE_ACTIVE_TAG = "cpl-nurture-active";
export const CPL_NURTURE_DONE_TAG = "cpl-nurture-21d-complete";

/** Statuses that end the nurture: enrolled, won, or lost (incl. all lost reasons). */
export const CPL_NURTURE_EXIT_STATUSES = [
  "APPLICATION_SUBMITTED",
  "CONVERTED",
  "WON",
  "NOT_INTERESTED",
  "JOINED_OTHERS",
  "INVALID_NUMBER",
  "TEST_LEAD",
  "JOB_SEEKER",
] as const;

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

export interface NurtureMessage {
  day: number;
  /** Days to wait after the previous message (0 for the first). */
  waitDays: number;
  templateName: string;
  providerCampaignId: string;
  headerValues?: string[];
  /** Ordered Interakt {{1}} template values (each template has 1 variable: name). */
  bodyValues: string[];
}

export const CPL_NURTURE_MESSAGES: NurtureMessage[] = [
  {
    day: 1,
    waitDays: 0,
    templateName: "cpl_nurture_d1_welcome_brochure",
    providerCampaignId: "936addd4-5cb5-47be-8a72-b2b549b8a29a",
    headerValues: ["https://www.airborneaviation.in/logo-primary.png"],
    bodyValues: ["{{name}}"],
  },
  {
    day: 3,
    waitDays: 2,
    templateName: "cpl_nurture_d3_founder_video",
    providerCampaignId: "353aa18e-cae9-4905-a742-fbb749cf6086",
    headerValues: ["https://www.airborneaviation.in/footage/cockpit_loop_short.mp4"],
    bodyValues: ["{{name}}"],
  },
  {
    day: 5,
    waitDays: 2,
    templateName: "cpl_nurture_d5_success_story",
    providerCampaignId: "0b093469-d685-49fc-b4d1-49cdbe83f368",
    headerValues: ["https://www.airborneaviation.in/logo-primary.png"],
    bodyValues: ["{{name}}"],
  },
  {
    day: 7,
    waitDays: 2,
    templateName: "cpl_nurture_d7_fees_scholarship",
    providerCampaignId: "8d78aa99-4571-4ece-97d6-024de0d441d5",
    bodyValues: ["{{name}}"],
  },
  {
    day: 10,
    waitDays: 3,
    templateName: "cpl_nurture_d10_batch_urgency",
    providerCampaignId: "cfd85fd6-0e7c-483e-8067-bab24ba16fd2",
    bodyValues: ["{{name}}"],
  },
  {
    day: 14,
    waitDays: 4,
    templateName: "cpl_nurture_d14_personal_followup",
    providerCampaignId: "587f14ac-fb1b-46cc-ad40-ecf7e4f30283",
    bodyValues: ["{{name}}"],
  },
  {
    day: 18,
    waitDays: 4,
    templateName: "cpl_nurture_d18_final_reminder",
    providerCampaignId: "c9851e73-29d9-480f-baa4-b1a72b6f7277",
    bodyValues: ["{{name}}"],
  },
  {
    day: 21,
    waitDays: 3,
    templateName: "cpl_nurture_d21_lastchance_altcourse",
    providerCampaignId: "5a6669f0-8913-47c5-ab8a-0bc52106aacc",
    bodyValues: ["{{name}}"],
  },
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

export function buildCplNurtureSteps(overrideCampaignId?: string): WorkflowStep[] {
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
      headerValues: msg.headerValues,
      providerCampaignId: overrideCampaignId ?? msg.providerCampaignId,
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
