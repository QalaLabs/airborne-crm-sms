import test from "node:test";
import assert from "node:assert/strict";
import { LeadSource, LeadStatus } from "@prisma/client";
import {
  INITIAL_LEAD_STATUSES,
  LOCKED_LEAD_STATUSES,
  LOST_STATUSES,
  LEGACY_LEAD_STATUSES,
  isInitialLeadStatus,
} from "./lead-status";
import { LEAD_SOURCE_OPTIONS, leadSourceLabel } from "./lead-source";
import { resolveImportSource } from "./lead-import";
import {
  createLeadSchema,
  updateLeadSchema,
  leadFiltersSchema,
  scheduleMeetingSchema,
  updateMeetingSchema,
} from "../validations/lead.schema";
import { MEETING_MODES, readMeetingMode, withMeetingMode } from "../crm/meeting-mode";

const baseLead = { name: "Walk In Person", phone: "9876500000" };
const LEAD_ID = "6f1c2f9e-3a52-4c55-9a3e-0b1c2d3e4f50";

// ── A1: walk-in source ──────────────────────────────────────────────
test("A1: WALK_IN is a canonical LeadSource accepted on create", () => {
  assert.ok(Object.values(LeadSource).includes("WALK_IN" as LeadSource));
  const parsed = createLeadSchema.parse({ ...baseLead, source: "WALK_IN" });
  assert.equal(parsed.source, "WALK_IN");
});

test("A1: unknown source is rejected", () => {
  assert.equal(createLeadSchema.safeParse({ ...baseLead, source: "WALKIN_TYPO" }).success, false);
});

test("A1: Walk-in has a readable label and appears in the source options", () => {
  assert.equal(leadSourceLabel("WALK_IN"), "Walk-in");
  assert.ok(LEAD_SOURCE_OPTIONS.some((o) => o.value === "WALK_IN" && o.label === "Walk-in"));
  assert.equal(LEAD_SOURCE_OPTIONS.length, Object.values(LeadSource).length);
});

test("A1: update without a source leaves the stored source untouched", () => {
  const parsed = updateLeadSchema.parse({ name: "Renamed" });
  assert.equal(parsed.source, undefined);
});

test("A1: CSV import maps walk-in spellings to WALK_IN", () => {
  for (const raw of ["WALK_IN", "walk-in", "Walk In", "walkin"]) {
    assert.equal(resolveImportSource(raw), "WALK_IN", raw);
  }
});

// ── A3: initial status ──────────────────────────────────────────────
test("A3: initial statuses exclude locked, lost, legacy and PROSPECT", () => {
  for (const s of [...LOCKED_LEAD_STATUSES, ...LOST_STATUSES, ...LEGACY_LEAD_STATUSES, LeadStatus.PROSPECT]) {
    assert.ok(!INITIAL_LEAD_STATUSES.includes(s), `${s} must not be an initial status`);
    assert.equal(isInitialLeadStatus(s), false);
  }
  assert.ok(INITIAL_LEAD_STATUSES.includes(LeadStatus.NEW));
});

test("A3: createLeadSchema accepts every initial status", () => {
  for (const status of INITIAL_LEAD_STATUSES) {
    assert.equal(createLeadSchema.parse({ ...baseLead, status }).status, status);
  }
});

test("A3: createLeadSchema rejects WON, CONVERTED, PROSPECT, LOST and unknown statuses", () => {
  for (const status of ["WON", "CONVERTED", "PROSPECT", "LOST", "NOT_INTERESTED", "COUNSELED", "BOGUS"]) {
    assert.equal(createLeadSchema.safeParse({ ...baseLead, status }).success, false, status);
  }
});

test("A3: status is optional on create (lead stays NEW by default)", () => {
  assert.equal(createLeadSchema.parse(baseLead).status, undefined);
});

test("A3: updateLeadSchema still allows the full status vocabulary (transition rules live in the service)", () => {
  assert.equal(updateLeadSchema.parse({ status: "PROSPECT" }).status, "PROSPECT");
});

// ── C1: created date filter (IST) ───────────────────────────────────
test("C1: date-only bounds are IST start/end of day", () => {
  const f = leadFiltersSchema.parse({ dateFrom: "2026-10-01", dateTo: "2026-10-01" });
  assert.equal(f.dateFrom, "2026-09-30T18:30:00.000Z");
  assert.equal(f.dateTo, "2026-10-01T18:29:59.999Z");
});

test("C1: ISO datetimes still pass through", () => {
  const f = leadFiltersSchema.parse({ dateFrom: "2026-10-01T00:00:00.000Z" });
  assert.equal(f.dateFrom, "2026-10-01T00:00:00.000Z");
});

test("C1: start after end is rejected", () => {
  const r = leadFiltersSchema.safeParse({ dateFrom: "2026-10-05", dateTo: "2026-10-01" });
  assert.equal(r.success, false);
  assert.match(JSON.stringify(r.error?.issues), /on or before/);
});

test("C1: malformed and impossible dates are rejected", () => {
  for (const bad of ["2026-02-30", "01-10-2026", "yesterday", "2026-13-01"]) {
    assert.equal(leadFiltersSchema.safeParse({ dateFrom: bad }).success, false, bad);
  }
});

test("C1: open-ended ranges are allowed", () => {
  assert.equal(leadFiltersSchema.safeParse({ dateFrom: "2026-10-01" }).success, true);
  assert.equal(leadFiltersSchema.safeParse({ dateTo: "2026-10-01" }).success, true);
});

// ── B1: meeting mode ────────────────────────────────────────────────
test("B1: every supported meeting mode is accepted", () => {
  for (const mode of MEETING_MODES) {
    const parsed = scheduleMeetingSchema.parse({ leadId: LEAD_ID, dueAt: "2026-10-10T05:00:00.000Z", mode });
    assert.equal(parsed.mode, mode);
  }
});

test("B1: unsupported mode is rejected, including via metadata.mode", () => {
  const dueAt = "2026-10-10T05:00:00.000Z";
  assert.equal(scheduleMeetingSchema.safeParse({ leadId: LEAD_ID, dueAt, mode: "PHONE" }).success, false);
  assert.equal(scheduleMeetingSchema.safeParse({ leadId: LEAD_ID, dueAt, metadata: { mode: "PHONE" } }).success, false);
  assert.equal(updateMeetingSchema.safeParse({ mode: "HYBRID" }).success, false);
});

test("B1: mode is optional (legacy meetings and callers without a mode)", () => {
  const parsed = scheduleMeetingSchema.parse({ leadId: LEAD_ID, dueAt: "2026-10-10T05:00:00.000Z" });
  assert.equal(parsed.mode, undefined);
  assert.equal(readMeetingMode(null), null);
  assert.equal(readMeetingMode({}), null);
  assert.equal(readMeetingMode({ mode: "TELEPATHY" }), null);
  assert.equal(readMeetingMode({ mode: "CAMPUS_VISIT" }), "CAMPUS_VISIT");
});

test("B1: withMeetingMode keeps other metadata and lets the explicit mode win", () => {
  assert.deepEqual(withMeetingMode({ room: "B2", mode: "ONLINE" }, "OFFLINE"), { room: "B2", mode: "OFFLINE" });
  assert.deepEqual(withMeetingMode({ room: "B2" }, undefined), { room: "B2" });
  assert.equal(withMeetingMode(undefined, undefined), undefined);
});
