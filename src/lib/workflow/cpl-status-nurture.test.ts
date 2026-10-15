import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCondition } from "./conditions";
import {
  buildCplNurtureKillSteps,
  buildCplNurtureSteps,
  CPL_NURTURE_ACTIVE_TAG,
  CPL_NURTURE_EXIT_STATUSES,
  CPL_NURTURE_KILL_TRIGGER_CONDITIONS,
  CPL_NURTURE_MESSAGES,
  CPL_NURTURE_TRIGGER_CONDITIONS,
  CPL_NURTURE_WORKFLOW_CODE,
} from "./cpl-status-nurture";
import { resolveCourseSlug } from "@/lib/courses/eligibility";
import { workflowStepSchema } from "@/lib/validations/workflow.schema";

const withSlug = (l: Record<string, unknown>) => ({
  ...l,
  courseSlug: resolveCourseSlug(l.courseInterest as string | null),
});

const lead = {
  status: "NEW",
  courseInterest: "Commercial Pilot License (CPL)",
  courseSlug: "commercial-pilot-license-cpl",
  phone: "+919876543210",
  whatsappOptOut: false,
  tags: ["web"],
  event: {},
};

test("all steps pass workflow step validation", () => {
  for (const step of [...buildCplNurtureSteps("camp-1"), ...buildCplNurtureKillSteps()]) {
    assert.ok(workflowStepSchema.safeParse(step).success, `invalid step: ${JSON.stringify(step)}`);
  }
});

test("uses the 8 approved template names in order", () => {
  const names = buildCplNurtureSteps()
    .filter((s) => s.type === "SEND_WHATSAPP")
    .map((s) => (s as { templateName?: string }).templateName);
  assert.deepEqual(names, [
    "cpl_nurture_d1_welcome_brochure",
    "cpl_nurture_d3_founder_video",
    "cpl_nurture_d5_success_story",
    "cpl_nurture_d7_fees_scholarship",
    "cpl_nurture_d10_batch_urgency",
    "cpl_nurture_d14_personal_followup",
    "cpl_nurture_d18_final_reminder",
    "cpl_nurture_d21_lastchance_altcourse",
  ]);
});

test("waits sum to 20 days so Day 21 lands on day 21", () => {
  const total = buildCplNurtureSteps().reduce(
    (sum, s) => sum + (s.type === "WAIT" ? (s.duration.days ?? 0) : 0),
    0,
  );
  assert.equal(total, 20);
  assert.equal(CPL_NURTURE_MESSAGES.at(-1)?.day, 21);
});

test("every send after Day 1 is preceded by a wait then an exit guard", () => {
  const steps = buildCplNurtureSteps();
  steps.forEach((s, i) => {
    if (s.type !== "SEND_WHATSAPP" || i === 1) return; // i===1 is Day 1
    assert.equal(steps[i - 1]?.type, "CONDITION", `no guard before ${s.name}`);
    assert.equal(steps[i - 2]?.type, "WAIT");
  });
});

test("campaign id is attached to every send when provided", () => {
  const sends = buildCplNurtureSteps("camp-1").filter((s) => s.type === "SEND_WHATSAPP");
  assert.equal(sends.length, 8);
  assert.ok(sends.every((s) => (s as { providerCampaignId?: string }).providerCampaignId === "camp-1"));
});

test("entry: CPL lead created at NEW matches", () => {
  assert.equal(evaluateCondition(CPL_NURTURE_TRIGGER_CONDITIONS, lead), true);
  assert.equal(evaluateCondition(CPL_NURTURE_TRIGGER_CONDITIONS, withSlug({ ...lead, courseInterest: "DGCA CPL" })), true);
});

test("entry: DGCA CPL Ground Classes leads match", () => {
  const ctx = withSlug({ ...lead, courseInterest: "DGCA CPL Ground Classes (₹2,70,000)" });
  assert.equal(evaluateCondition(CPL_NURTURE_TRIGGER_CONDITIONS, ctx), true);
});

test("entry: rejects non-CPL, opted-out, non-NEW status, no phone, already active", () => {
  const no = (patch: Record<string, unknown>) =>
    assert.equal(evaluateCondition(CPL_NURTURE_TRIGGER_CONDITIONS, withSlug({ ...lead, ...patch })), false);
  no({ courseInterest: "Cabin Crew Training (₹54,000)" });
  no({ courseInterest: "Airbus A320 Simulator FBS (₹10,000)" });
  no({ courseInterest: "A320 Simulator Training" });
  no({ courseInterest: "Airline Preparation (₹1,25,000)" });
  no({ courseInterest: "Comprehensive Airline Preparation Program (₹1,25,000)" });
  no({ courseInterest: "CPL & Airline Preparation" });
  no({ courseInterest: "ATPL Ground School (₹1,50,000)" });
  no({ courseInterest: "Private Pilot License (PPL)" });
  no({ courseInterest: "Cadet Pilot Program" });
  no({ courseInterest: null });
  no({ whatsappOptOut: true });
  no({ status: "FOLLOW_UP" });
  no({ phone: null });
  no({ tags: ["web", CPL_NURTURE_ACTIVE_TAG] });
  no({ tags: ["web", "cpl-nurture-21d-complete"] });
});

test("kill switch matches exit statuses only", () => {
  for (const status of CPL_NURTURE_EXIT_STATUSES) {
    assert.equal(evaluateCondition(CPL_NURTURE_KILL_TRIGGER_CONDITIONS, { event: { newStatus: status } }), true, status);
  }
  for (const status of ["INTERESTED", "FOLLOW_UP", "CONNECTED", "CALL_BACK", "RINGING", "COUNSELED"]) {
    assert.equal(evaluateCondition(CPL_NURTURE_KILL_TRIGGER_CONDITIONS, { event: { newStatus: status } }), false, status);
  }
});

test("kill switch only targets the nurture workflow", () => {
  const stop = buildCplNurtureKillSteps().find((s) => s.type === "STOP_WORKFLOW");
  assert.ok(stop && stop.type === "STOP_WORKFLOW");
  assert.equal(stop.stopAllForEntity, true);
  assert.equal(stop.onlyWorkflowCode, CPL_NURTURE_WORKFLOW_CODE);
});

test("no step stops the nurture on a WhatsApp reply", () => {
  assert.ok(!JSON.stringify(buildCplNurtureSteps()).includes("WHATSAPP_REPLIED"));
});
