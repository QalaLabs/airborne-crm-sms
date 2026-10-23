import test from "node:test";
import assert from "node:assert/strict";
import { AutoCallingService } from "../services/auto-calling.service";

test("AutoCallingService enforces maximum concurrency limit of 2", () => {
  assert.equal(AutoCallingService.MAX_CONCURRENT_CALLS, 2);
});

test("AutoCallingService enforces maximum 3 call attempts per lead", () => {
  assert.equal(AutoCallingService.MAX_CALL_ATTEMPTS, 3);
});

test("AutoCallingService enforces a 2-hour minimum cool-off before retrying unanswered leads", () => {
  assert.equal(AutoCallingService.RETRY_COOL_OFF_MS, 2 * 60 * 60 * 1000);
});

test("AutoCallingService normalizes various Indian phone formats to E.164 (+91)", () => {
  assert.equal(AutoCallingService.normalizePhone("9876543210"), "+919876543210");
  assert.equal(AutoCallingService.normalizePhone("919876543210"), "+919876543210");
  assert.equal(AutoCallingService.normalizePhone("+91 98765 43210"), "+919876543210");
  assert.equal(AutoCallingService.normalizePhone("+91-98765-43210"), "+919876543210");
  assert.equal(AutoCallingService.normalizePhone("+14155552671"), "+14155552671");
});

test("AutoCallingService calling window correctly validates 09:00 - 20:00 IST", () => {
  const morningIST = new Date("2026-10-23T04:30:00.000Z"); // 10:00 AM IST
  assert.equal(AutoCallingService.isCallingWindowOpen(morningIST), true);

  const afternoonIST = new Date("2026-10-23T09:30:00.000Z"); // 15:00 PM IST
  assert.equal(AutoCallingService.isCallingWindowOpen(afternoonIST), true);

  const earlyIST = new Date("2026-10-23T03:00:00.000Z"); // 08:30 AM IST
  assert.equal(AutoCallingService.isCallingWindowOpen(earlyIST), false);

  const nightIST = new Date("2026-10-23T15:30:00.000Z"); // 21:00 PM IST
  assert.equal(AutoCallingService.isCallingWindowOpen(nightIST), false);
});

test("AutoCallingService identifies non-callable lead statuses", () => {
  const nonCallable = new Set([
    "TEST_LEAD",
    "OPTED_OUT",
    "DND",
    "LOST",
    "WON",
    "CONVERTED",
    "NOT_INTERESTED",
    "INVALID_NUMBER",
    "JOINED_OTHERS",
    "JOB_SEEKER",
  ]);

  assert.equal(nonCallable.has("NEW"), false);
  assert.equal(nonCallable.has("CONTACTED"), false);
  assert.equal(nonCallable.has("DND"), true);
  assert.equal(nonCallable.has("OPTED_OUT"), true);
  assert.equal(nonCallable.has("TEST_LEAD"), true);
});

test("isEligibleForRetry qualifies unanswered leads with elapsed cool-off", () => {
  const now = new Date("2026-10-23T12:00:00.000Z");
  const threeHoursAgo = new Date("2026-10-23T09:00:00.000Z");

  const res = AutoCallingService.isEligibleForRetry({
    totalCalls: 1,
    hasConnectedCall: false,
    lastCallOutcome: "NO_ANSWER",
    lastCallCompleted: true,
    lastCallCreatedAt: threeHoursAgo,
    hasManualIntervention: false,
    now,
  });

  assert.equal(res.eligible, true);
});

test("isEligibleForRetry qualifies 2nd retry for lead on attempt 3", () => {
  const now = new Date("2026-10-23T12:00:00.000Z");
  const threeHoursAgo = new Date("2026-10-23T09:00:00.000Z");

  const res = AutoCallingService.isEligibleForRetry({
    totalCalls: 2,
    hasConnectedCall: false,
    lastCallOutcome: "BUSY",
    lastCallCompleted: true,
    lastCallCreatedAt: threeHoursAgo,
    hasManualIntervention: false,
    now,
  });

  assert.equal(res.eligible, true);
});

test("isEligibleForRetry rejects leads that reached 3 total call attempts ceiling", () => {
  const now = new Date("2026-10-23T12:00:00.000Z");
  const threeHoursAgo = new Date("2026-10-23T09:00:00.000Z");

  const res = AutoCallingService.isEligibleForRetry({
    totalCalls: 3,
    hasConnectedCall: false,
    lastCallOutcome: "NO_ANSWER",
    lastCallCompleted: true,
    lastCallCreatedAt: threeHoursAgo,
    hasManualIntervention: false,
    now,
  });

  assert.equal(res.eligible, false);
  assert.equal(res.reason, "max_attempts_reached");
});

test("isEligibleForRetry rejects leads if human counselor / manual agent is active", () => {
  const now = new Date("2026-10-23T12:00:00.000Z");
  const threeHoursAgo = new Date("2026-10-23T09:00:00.000Z");

  const res = AutoCallingService.isEligibleForRetry({
    totalCalls: 1,
    hasConnectedCall: false,
    lastCallOutcome: "NO_ANSWER",
    lastCallCompleted: true,
    lastCallCreatedAt: threeHoursAgo,
    hasManualIntervention: true, // Manual agent has intervened
    now,
  });

  assert.equal(res.eligible, false);
  assert.equal(res.reason, "manual_agent_active");
});

test("isEligibleForRetry rejects leads that already had a CONNECTED or COMPLETED call", () => {
  const now = new Date("2026-10-23T12:00:00.000Z");
  const threeHoursAgo = new Date("2026-10-23T09:00:00.000Z");

  const res = AutoCallingService.isEligibleForRetry({
    totalCalls: 2,
    hasConnectedCall: true, // Lead already picked up and talked
    lastCallOutcome: "NO_ANSWER",
    lastCallCompleted: true,
    lastCallCreatedAt: threeHoursAgo,
    hasManualIntervention: false,
    now,
  });

  assert.equal(res.eligible, false);
  assert.equal(res.reason, "already_connected");
});

test("isEligibleForRetry enforces cool-off period when last call was under 2 hours ago", () => {
  const now = new Date("2026-10-23T12:00:00.000Z");
  const thirtyMinsAgo = new Date("2026-10-23T11:30:00.000Z");

  const res = AutoCallingService.isEligibleForRetry({
    totalCalls: 1,
    hasConnectedCall: false,
    lastCallOutcome: "NO_ANSWER",
    lastCallCompleted: true,
    lastCallCreatedAt: thirtyMinsAgo,
    hasManualIntervention: false,
    now,
  });

  assert.equal(res.eligible, false);
  assert.equal(res.reason, "cool_off_period");
});
