import test from "node:test";
import assert from "node:assert/strict";
import { BATCH_FREQUENCIES, createBatchSchema, updateBatchSchema } from "./lms.schema";

const base = { courseId: "00000000-0000-4000-8000-000000000c01", name: "Morning A" };
const NOV1 = "2026-11-01T00:00:00.000Z";
const JAN31 = "2027-01-31T00:00:00.000Z";

for (const frequency of BATCH_FREQUENCIES) {
  test(`API accepts frequency ${frequency} with a time window and keeps the value verbatim`, () => {
    const r = createBatchSchema.safeParse({ ...base, schedule: { frequency, startTime: "09:00", endTime: "11:30" } });
    assert.equal(r.success, true, frequency);
    assert.equal(r.success && r.data.schedule?.frequency, frequency);
  });
}

test("API frequency enum is exactly the seven canonical values", () => {
  assert.deepEqual([...BATCH_FREQUENCIES], ["DAILY", "WEEKLY", "CONSECUTIVE", "ALTERNATE", "BI_WEEKLY", "MONTHLY", "BI_MONTHLY"]);
  for (const bad of ["HOURLY", "daily", "Bi-weekly", "BIWEEKLY", ""]) {
    assert.equal(createBatchSchema.safeParse({ ...base, schedule: { frequency: bad } }).success, false, bad);
  }
});

test("API rejects malformed, backward, equal and half-filled time windows", () => {
  assert.equal(createBatchSchema.safeParse({ ...base, schedule: { startTime: "9am", endTime: "10:00" } }).success, false);
  assert.equal(createBatchSchema.safeParse({ ...base, schedule: { startTime: "11:00", endTime: "10:00" } }).success, false);
  assert.equal(createBatchSchema.safeParse({ ...base, schedule: { startTime: "10:00", endTime: "10:00" } }).success, false);
  assert.equal(createBatchSchema.safeParse({ ...base, schedule: { startTime: "22:00", endTime: "02:00" } }).success, false);
  assert.equal(createBatchSchema.safeParse({ ...base, schedule: { startTime: "09:00" } }).success, false);
  assert.equal(createBatchSchema.safeParse({ ...base, schedule: { endTime: "09:00" } }).success, false);
});

test("API date rules: valid range, same day, backward, end without start, non-ISO", () => {
  assert.equal(createBatchSchema.safeParse({ ...base, startDate: NOV1, endDate: JAN31 }).success, true);
  assert.equal(createBatchSchema.safeParse({ ...base, startDate: NOV1, endDate: NOV1 }).success, true);
  assert.equal(createBatchSchema.safeParse({ ...base, startDate: JAN31, endDate: NOV1 }).success, false);
  assert.equal(createBatchSchema.safeParse({ ...base, endDate: JAN31 }).success, false);
  assert.equal(createBatchSchema.safeParse({ ...base, startDate: "2026-11-01" }).success, false);
  assert.equal(updateBatchSchema.safeParse({ startDate: JAN31, endDate: NOV1 }).success, false);
});

test("schedule stays optional for existing callers", () => {
  assert.equal(createBatchSchema.safeParse(base).success, true);
  assert.equal(createBatchSchema.safeParse({ ...base, schedule: { frequency: null, startTime: null, endTime: null } }).success, true);
  assert.equal(updateBatchSchema.safeParse({ name: "Renamed" }).success, true);
});
