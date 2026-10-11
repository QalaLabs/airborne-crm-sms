import test from "node:test";
import assert from "node:assert/strict";
import { istWeekContaining, parseISTWeek, shiftISTWeek } from "./ist-week";

test("week runs Monday 00:00 IST to Sunday 23:59:59.999 IST", () => {
  // Thursday 1 Oct 2026, 12:00 IST
  const w = istWeekContaining(new Date("2026-10-01T06:30:00.000Z"));
  assert.equal(w.key, "2026-09-28");
  assert.equal(w.endKey, "2026-10-04");
  assert.equal(w.start.toISOString(), "2026-09-27T18:30:00.000Z");
  assert.equal(w.end.toISOString(), "2026-10-04T18:29:59.999Z");
  assert.equal(w.label, "28 Sep 2026 – 4 Oct 2026");
});

test("IST boundary: Sunday 23:59 IST and Monday 00:00 IST fall in different weeks", () => {
  const sundayLate = istWeekContaining(new Date("2026-10-04T18:29:00.000Z")); // Sun 23:59 IST
  const mondayEarly = istWeekContaining(new Date("2026-10-04T18:30:00.000Z")); // Mon 00:00 IST
  assert.equal(sundayLate.key, "2026-09-28");
  assert.equal(mondayEarly.key, "2026-10-05");
});

test("IST boundary: Monday 02:00 IST is still Sunday in UTC but belongs to the new week", () => {
  const w = istWeekContaining(new Date("2026-10-04T20:30:00.000Z"));
  assert.equal(w.key, "2026-10-05");
});

test("parseISTWeek snaps any date to its Monday and rejects bad input", () => {
  assert.equal(parseISTWeek("2026-10-01")?.key, "2026-09-28");
  assert.equal(parseISTWeek("2026-09-28")?.key, "2026-09-28");
  assert.equal(parseISTWeek("2026-10-04")?.key, "2026-09-28");
  assert.equal(parseISTWeek("2026-02-30"), null);
  assert.equal(parseISTWeek("28/09/2026"), null);
  assert.equal(parseISTWeek(""), null);
});

test("shiftISTWeek moves whole weeks, across month and year ends", () => {
  const w = parseISTWeek("2026-12-28")!;
  assert.equal(shiftISTWeek(w, 1).key, "2027-01-04");
  assert.equal(shiftISTWeek(w, -1).key, "2026-12-21");
  assert.equal(shiftISTWeek(shiftISTWeek(w, 3), -3).key, w.key);
});
