import test from "node:test";
import assert from "node:assert/strict";
import { AutoCallingService } from "../services/auto-calling.service";

test("AutoCallingService enforces maximum concurrency limit of 2", () => {
  assert.equal(AutoCallingService.MAX_CONCURRENT_CALLS, 2);
});

test("AutoCallingService normalizes various Indian phone formats to E.164 (+91)", () => {
  assert.equal(AutoCallingService.normalizePhone("9876543210"), "+919876543210");
  assert.equal(AutoCallingService.normalizePhone("919876543210"), "+919876543210");
  assert.equal(AutoCallingService.normalizePhone("+91 98765 43210"), "+919876543210");
  assert.equal(AutoCallingService.normalizePhone("+91-98765-43210"), "+919876543210");
  assert.equal(AutoCallingService.normalizePhone("+14155552671"), "+14155552671");
});

test("AutoCallingService calling window correctly validates 09:00 - 20:00 IST", () => {
  // 10:00 AM IST (04:30 AM UTC) -> inside window
  const morningIST = new Date("2026-10-23T04:30:00.000Z");
  assert.equal(AutoCallingService.isCallingWindowOpen(morningIST), true);

  // 15:00 PM IST (09:30 AM UTC) -> inside window
  const afternoonIST = new Date("2026-10-23T09:30:00.000Z");
  assert.equal(AutoCallingService.isCallingWindowOpen(afternoonIST), true);

  // 08:30 AM IST (03:00 AM UTC) -> before window
  const earlyIST = new Date("2026-10-23T03:00:00.000Z");
  assert.equal(AutoCallingService.isCallingWindowOpen(earlyIST), false);

  // 21:00 PM IST (15:30 PM UTC) -> after window
  const nightIST = new Date("2026-10-23T15:30:00.000Z");
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
