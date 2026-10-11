import { test } from "node:test";
import assert from "node:assert/strict";
import { leadTrashRetentionDays, trashDaysLeft, trashPurgeAt, trashPurgeCutoff } from "./lead-trash";

test("retention defaults to 30 and accepts only 1–365 whole days", () => {
  assert.equal(leadTrashRetentionDays(undefined), 30);
  assert.equal(leadTrashRetentionDays(""), 30);
  assert.equal(leadTrashRetentionDays("7"), 7);
  assert.equal(leadTrashRetentionDays("0"), 30);
  assert.equal(leadTrashRetentionDays("400"), 30);
  assert.equal(leadTrashRetentionDays("2.5"), 30);
  assert.equal(leadTrashRetentionDays("abc"), 30);
});

test("purge cutoff and purge date are retention days apart", () => {
  const now = new Date("2026-09-28T06:00:00Z");
  assert.equal(trashPurgeCutoff(30, now).toISOString(), "2026-08-29T06:00:00.000Z");
  assert.equal(trashPurgeAt("2026-09-01T06:00:00Z", 30).toISOString(), "2026-10-01T06:00:00.000Z");
});

test("days left counts down and never goes negative", () => {
  const now = new Date("2026-09-28T06:00:00Z");
  assert.equal(trashDaysLeft("2026-09-28T06:00:00Z", 30, now), 30);
  assert.equal(trashDaysLeft("2026-09-27T12:00:00Z", 30, now), 30);
  assert.equal(trashDaysLeft("2026-08-30T06:00:00Z", 30, now), 1);
  assert.equal(trashDaysLeft("2026-08-01T06:00:00Z", 30, now), 0);
});
