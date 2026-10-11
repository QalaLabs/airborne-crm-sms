import test from "node:test";
import assert from "node:assert/strict";
import { LeadStatus, LeadSource } from "@prisma/client";
import {
  ACTIVE_LEAD_STATUSES,
  CONNECTED_STATUSES,
  LOST_STATUSES,
  TODAY_FOLLOW_UP_STATUSES,
  OPPORTUNITY_STATUS,
  WON_STATUS,
  LOCKED_LEAD_STATUSES,
  LOSS_REASON_DEFAULT_TEXT,
  isLostStatus,
  isActiveStatus,
  statusLabel,
  canTransitionLeadStatus,
  getAllowedLeadStatuses,
} from "./lead-status";
import { createLeadSchema, leadFiltersSchema } from "../validations/lead.schema";

test("ACTIVE_LEAD_STATUSES = every non-terminal status (no LOST*, WON, CONVERTED)", () => {
  const terminal = new Set<LeadStatus>([...LOST_STATUSES, LeadStatus.WON, LeadStatus.CONVERTED]);
  for (const s of ACTIVE_LEAD_STATUSES) {
    assert.ok(!terminal.has(s), `${s} is terminal and must not be active`);
  }
  for (const s of [
    LeadStatus.NEW,
    LeadStatus.CONTACTED,
    LeadStatus.CONNECTED,
    LeadStatus.CALL_BACK,
    LeadStatus.INTERESTED,
    LeadStatus.PROSPECT,
    LeadStatus.FOLLOW_UP,
    LeadStatus.NOT_CONNECTED,
  ]) {
    assert.ok(ACTIVE_LEAD_STATUSES.includes(s), `${s} should be active`);
  }
});

test("ACTIVE_LEAD_STATUSES covers every LeadStatus that is neither lost nor won/converted", () => {
  const terminal = new Set<LeadStatus>([...LOST_STATUSES, LeadStatus.WON, LeadStatus.CONVERTED]);
  const uncategorised = Object.values(LeadStatus).filter(
    (s) => !terminal.has(s) && !ACTIVE_LEAD_STATUSES.includes(s),
  );
  assert.deepEqual(uncategorised, [], "every status must be either active or terminal");
});

test("LOST_STATUSES contains terminal statuses and excludes WON", () => {
  assert.ok(LOST_STATUSES.includes(LeadStatus.LOST));
  assert.ok(LOST_STATUSES.includes(LeadStatus.PRICE_HIGH));
  assert.ok(LOST_STATUSES.includes(LeadStatus.NOT_ELIGIBLE));
  assert.ok(LOST_STATUSES.includes(LeadStatus.TEST_LEAD));
  assert.ok(LOST_STATUSES.includes(LeadStatus.NOT_INTERESTED));
  assert.ok(LOST_STATUSES.includes(LeadStatus.REASON_NOT_SHARED));
  assert.ok(LOST_STATUSES.includes(LeadStatus.JOB_SEEKER));
  assert.ok(!LOST_STATUSES.includes(LeadStatus.WON));
  assert.ok(!LOST_STATUSES.includes(LeadStatus.PROSPECT));
});

test("CONNECTED_STATUSES are productive funnel statuses", () => {
  assert.ok(CONNECTED_STATUSES.includes(LeadStatus.CONNECTED));
  assert.ok(CONNECTED_STATUSES.includes(LeadStatus.CALL_BACK));
  assert.ok(CONNECTED_STATUSES.includes(LeadStatus.PROSPECT));
  assert.ok(CONNECTED_STATUSES.includes(LeadStatus.WON));
  assert.ok(!CONNECTED_STATUSES.includes(LeadStatus.NOT_REACHABLE));
});

test("TODAY_FOLLOW_UP_STATUSES per Phase 2 spec", () => {
  for (const s of [LeadStatus.CALL_BACK, LeadStatus.NOT_CONNECTED, LeadStatus.NOT_CONTACTABLE, LeadStatus.INTERESTED, LeadStatus.PROSPECT]) {
    assert.ok(TODAY_FOLLOW_UP_STATUSES.includes(s), `${s} should be a follow-up status`);
  }
});

test("OPPORTUNITY_STATUS is PROSPECT and WON_STATUS is WON", () => {
  assert.equal(OPPORTUNITY_STATUS, LeadStatus.PROSPECT);
  assert.equal(WON_STATUS, LeadStatus.WON);
});

test("isLostStatus / isActiveStatus helpers", () => {
  assert.equal(isLostStatus(LeadStatus.LOST), true);
  assert.equal(isLostStatus(LeadStatus.PROSPECT), false);
  assert.equal(isActiveStatus(LeadStatus.NEW), true);
  assert.equal(isActiveStatus(LeadStatus.CALL_BACK), true);
  assert.equal(isActiveStatus(LeadStatus.PROSPECT), true);
  assert.equal(isActiveStatus(LeadStatus.WON), false);
  assert.equal(isActiveStatus(LeadStatus.LOST), false);
});

test("statusLabel humanises enum values", () => {
  assert.equal(statusLabel("PRICE_HIGH"), "Price High");
  assert.equal(statusLabel("NOT_ELIGIBLE"), "Not Eligible");
});

test("createLeadSchema accepts pincode, googleId, manualAmount", () => {
  const parsed = createLeadSchema.parse({
    name: "Test User",
    phone: "9876543210",
    email: "test@example.com",
    pincode: "110001",
    googleId: "g-12345",
    manualAmount: 50000,
  });
  assert.equal(parsed.pincode, "110001");
  assert.equal(parsed.googleId, "g-12345");
  assert.equal(parsed.manualAmount, 50000);
});

test("createLeadSchema rejects negative manualAmount and long pincode", () => {
  assert.throws(() =>
    createLeadSchema.parse({ name: "Test", phone: "9876543210", manualAmount: -5 }),
  );
  assert.throws(() =>
    createLeadSchema.parse({ name: "Test", phone: "9876543210", pincode: "1234567890123" }),
  );
});

test("leadFiltersSchema accepts all new lead statuses", async () => {
  for (const s of [
    "PROSPECT",
    "CALL_BACK",
    "NOT_REACHABLE",
    "PRICE_HIGH",
    "NOT_ELIGIBLE",
    "TEST_LEAD",
  ]) {
    const r = await leadFiltersSchema.safeParseAsync({ status: s });
    assert.equal(r.success, true, `${s} should be a valid filter status`);
  }
});

test("leadFiltersSchema rejects an unknown status", async () => {
  const r = await leadFiltersSchema.safeParseAsync({ status: "IMAGINARY_STATUS" });
  assert.equal(r.success, false);
});

test("SECTION3: LOST_STATUSES includes the new lost taxonomy values", () => {
  assert.ok(LOST_STATUSES.includes(LeadStatus.NOT_INTERESTED));
  assert.ok(LOST_STATUSES.includes(LeadStatus.REASON_NOT_SHARED));
  assert.ok(isLostStatus(LeadStatus.NOT_INTERESTED));
  assert.ok(isLostStatus(LeadStatus.REASON_NOT_SHARED));
});

test("SECTION3: reason-only lost statuses have a default persisted reason", () => {
  assert.equal(
    LOSS_REASON_DEFAULT_TEXT[LeadStatus.NOT_INTERESTED],
    "Not interested in the course",
  );
  assert.equal(
    LOSS_REASON_DEFAULT_TEXT[LeadStatus.REASON_NOT_SHARED],
    "Not Interested — Reason Not Shared",
  );
});

test("SECTION3: leadFiltersSchema accepts NOT_INTERESTED / REASON_NOT_SHARED", async () => {
  for (const s of ["NOT_INTERESTED", "REASON_NOT_SHARED"]) {
    const r = await leadFiltersSchema.safeParseAsync({ status: s });
    assert.equal(r.success, true, `${s} should be a valid filter status`);
  }
});

test("SECTION3: WON / CONVERTED are system-locked (no manual moves)", () => {
  for (const locked of LOCKED_LEAD_STATUSES) {
    assert.equal(canTransitionLeadStatus(locked, LeadStatus.PROSPECT), false);
    assert.equal(canTransitionLeadStatus(locked, LeadStatus.LOST), false);
    assert.equal(canTransitionLeadStatus(locked, locked), true);
  }
});

test("SECTION3: any active status may move to a lost status (reason persisted)", () => {
  for (const from of [LeadStatus.NEW, LeadStatus.CONNECTED, LeadStatus.PROSPECT]) {
    for (const to of [LeadStatus.NOT_INTERESTED, LeadStatus.REASON_NOT_SHARED, LeadStatus.PRICE_HIGH]) {
      assert.equal(canTransitionLeadStatus(from, to), true, `${from} → ${to}`);
    }
  }
});

test("SECTION3: lost statuses may be re-opened to an active status", () => {
  for (const from of [LeadStatus.NOT_INTERESTED, LeadStatus.REASON_NOT_SHARED, LeadStatus.PRICE_HIGH]) {
    assert.equal(canTransitionLeadStatus(from, LeadStatus.PROSPECT), true);
    assert.equal(canTransitionLeadStatus(from, LeadStatus.INTERESTED), true);
  }
});

test("lost reasons can be corrected to another lost reason (e.g. NOT_INTERESTED → JOB_SEEKER)", () => {
  assert.equal(canTransitionLeadStatus(LeadStatus.NOT_INTERESTED, LeadStatus.JOB_SEEKER), true);
  assert.equal(canTransitionLeadStatus(LeadStatus.JOB_SEEKER, LeadStatus.REASON_NOT_SHARED), true);
  assert.equal(canTransitionLeadStatus(LeadStatus.PRICE_HIGH, LeadStatus.NOT_INTERESTED), true);
  assert.equal(canTransitionLeadStatus(LeadStatus.NOT_INTERESTED, LeadStatus.WON), false);
});

test("required lost reasons are selectable and labelled for users", () => {
  for (const s of [LeadStatus.NOT_INTERESTED, LeadStatus.REASON_NOT_SHARED, LeadStatus.JOB_SEEKER]) {
    assert.ok(getAllowedLeadStatuses(LeadStatus.NEW).includes(s), `${s} selectable from NEW`);
  }
  assert.equal(statusLabel("NOT_INTERESTED"), "Not Interested");
  assert.equal(statusLabel("REASON_NOT_SHARED"), "Not Interested - Reason Not Shared");
  assert.equal(statusLabel("JOB_SEEKER"), "Job Seeker");
});

test("SECTION3: does not transition a lead to WON/CONVERTED via the generic path", () => {
  for (const target of [LeadStatus.WON, LeadStatus.CONVERTED]) {
    assert.equal(
      getAllowedLeadStatuses(LeadStatus.PROSPECT).includes(target),
      false,
      `${target} must not be reachable via generic status change`,
    );
  }
});
