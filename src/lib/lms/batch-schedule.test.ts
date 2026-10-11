import test from "node:test";
import assert from "node:assert/strict";
import {
  BATCH_FREQUENCIES,
  FREQUENCY_LABELS,
  dateInputToIso,
  formatBatchDate,
  formatTime12h,
  parseSchedule,
  scheduleError,
  scheduleSummary,
} from "./batch-schedule";

test("12-hour conversion covers midnight, noon and PM", () => {
  assert.equal(formatTime12h("09:00"), "9:00 AM");
  assert.equal(formatTime12h("11:30"), "11:30 AM");
  assert.equal(formatTime12h("12:00"), "12:00 PM");
  assert.equal(formatTime12h("13:05"), "1:05 PM");
  assert.equal(formatTime12h("00:30"), "12:30 AM");
  assert.equal(formatTime12h("23:59"), "11:59 PM");
  assert.equal(formatTime12h("24:00"), null);
  assert.equal(formatTime12h("9:00"), null);
  assert.equal(formatTime12h(null), null);
});

test("date input becomes UTC midnight and renders as the same calendar day in IST", () => {
  assert.equal(dateInputToIso("2026-11-01"), "2026-11-01T00:00:00.000Z");
  assert.equal(dateInputToIso("2026-02-30"), null);
  assert.equal(dateInputToIso("01/11/2026"), null);
  assert.equal(dateInputToIso(""), null);
  assert.equal(formatBatchDate("2026-11-01T00:00:00.000Z"), "1 Nov 2026");
  assert.equal(formatBatchDate("2026-10-31T18:30:00.000Z"), "1 Nov 2026", "IST local midnight shows the same day");
  assert.equal(formatBatchDate("not-a-date"), null);
  assert.equal(formatBatchDate(null), null);
});

test("full summary matches the required display format", () => {
  const s = scheduleSummary({
    startDate: "2026-11-01T00:00:00.000Z",
    endDate: "2027-01-31T00:00:00.000Z",
    metadata: { schedule: { frequency: "DAILY", startTime: "09:00", endTime: "11:30" } },
  });
  assert.equal(s, "Daily · 9:00 AM – 11:30 AM · 1 Nov 2026 → 31 Jan 2027");
});

for (const frequency of BATCH_FREQUENCIES) {
  test(`frequency ${frequency}: stored value is kept verbatim and labelled on the card`, () => {
    const metadata = { schedule: { frequency, startTime: "18:00", endTime: "20:00" } };
    assert.equal(parseSchedule(metadata).frequency, frequency);
    const summary = scheduleSummary({ metadata, startDate: "2026-11-01T00:00:00.000Z" });
    assert.equal(summary, `${FREQUENCY_LABELS[frequency]} · 6:00 PM – 8:00 PM · from 1 Nov 2026`);
  });
}

test("frequency values are exactly the seven canonical enum values", () => {
  assert.deepEqual([...BATCH_FREQUENCIES], ["DAILY", "WEEKLY", "CONSECUTIVE", "ALTERNATE", "BI_WEEKLY", "MONTHLY", "BI_MONTHLY"]);
  assert.deepEqual(Object.values(FREQUENCY_LABELS), [
    "Daily",
    "Weekly",
    "Consecutive days",
    "Alternate days",
    "Bi-weekly",
    "Monthly",
    "Bi-monthly",
  ]);
});

test("legacy and malformed metadata never crash and degrade to what is valid", () => {
  assert.equal(scheduleSummary({}), null);
  assert.equal(scheduleSummary({ metadata: null }), null);
  assert.equal(scheduleSummary({ metadata: {} }), null);
  assert.equal(scheduleSummary({ metadata: "schedule" }), null);
  assert.equal(scheduleSummary({ metadata: [1, 2] }), null);
  assert.equal(scheduleSummary({ metadata: { schedule: "daily" } }), null);
  assert.equal(scheduleSummary({ metadata: { schedule: { frequency: "HOURLY", startTime: 9, endTime: {} } } }), null);
  assert.equal(scheduleSummary({ metadata: { schedule: { frequency: "WEEKLY" } } }), "Weekly");
  assert.equal(scheduleSummary({ startDate: "garbage", endDate: "2027-01-31T00:00:00.000Z" }), "until 31 Jan 2027");
  assert.equal(scheduleSummary({ metadata: { schedule: { startTime: "09:00" } } }), "from 9:00 AM");
  assert.equal(scheduleSummary({ startDate: "2026-11-01T00:00:00.000Z" }), "from 1 Nov 2026");
});

test("validation: valid window, backward/equal times, half-filled times, overnight unsupported", () => {
  assert.equal(scheduleError({ startTime: "09:00", endTime: "11:30" }), null);
  assert.equal(scheduleError({}), null);
  assert.match(scheduleError({ startTime: "11:00", endTime: "10:00" })!, /after start time/);
  assert.match(scheduleError({ startTime: "10:00", endTime: "10:00" })!, /after start time/);
  assert.match(scheduleError({ startTime: "22:00", endTime: "02:00" })!, /overnight batches are not supported/);
  assert.match(scheduleError({ startTime: "09:00" })!, /both a start time and an end time/);
  assert.match(scheduleError({ endTime: "09:00" })!, /both a start time and an end time/);
  assert.match(scheduleError({ startTime: "9am", endTime: "10:00" })!, /HH:MM/);
});

test("validation: valid dates, same-day, backward dates, end without start, invalid dates", () => {
  const nov1 = "2026-11-01T00:00:00.000Z";
  const jan31 = "2027-01-31T00:00:00.000Z";
  assert.equal(scheduleError({ startDate: nov1, endDate: jan31 }), null);
  assert.equal(scheduleError({ startDate: nov1, endDate: nov1 }), null);
  assert.equal(scheduleError({ startDate: nov1 }), null);
  assert.match(scheduleError({ startDate: jan31, endDate: nov1 })!, /on or after start date/);
  assert.match(scheduleError({ endDate: jan31 })!, /start date before an end date/);
  assert.match(scheduleError({ startDate: "nope", endDate: jan31 })!, /invalid/);
});
