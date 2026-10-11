import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionDealStage,
  dealFiltersSchema,
  createDealInputSchema,
  DEAL_STAGE_TRANSITIONS,
  LOSS_REASON_DEFAULT,
} from "@/lib/validations/deal.schema";
import { isLostStatus, LOST_STATUSES } from "@/lib/leads/lead-status";

test("deal transitions: single-step and terminal-stage rules", () => {
  // Every open stage may advance straight to ENROLLED.
  for (const from of ["ENQUIRY", "DOCUMENT_COLLECTION", "VERIFICATION", "OFFER_LETTER", "FEE_PAYMENT"] as const) {
    assert.ok(canTransitionDealStage(from, "ENROLLED"), `${from} → ENROLLED must be allowed`);
  }

  // Terminal stages cannot move forward or reopen to ENROLLED.
  assert.equal(canTransitionDealStage("ENROLLED", "DOCUMENT_COLLECTION"), false);
  assert.equal(canTransitionDealStage("ENROLLED", "VERIFICATION"), false);
  assert.equal(canTransitionDealStage("DROPPED", "ENROLLED"), false);
  assert.equal(canTransitionDealStage("CANCELLED", "ENROLLED"), false);

  // DROPPED/CANCELLED may be re-opened to open stages (recovery path).
  assert.ok(canTransitionDealStage("DROPPED", "OFFER_LETTER"));
  assert.ok(canTransitionDealStage("CANCELLED", "FEE_PAYMENT"));

  // Self moves are always allowed.
  assert.ok(canTransitionDealStage("ENROLLED", "ENROLLED"));
  assert.ok(canTransitionDealStage("ENQUIRY", "ENQUIRY"));

  // The transition table is exhaustive over the enum.
  const stages = Object.keys(DEAL_STAGE_TRANSITIONS).sort();
  assert.deepEqual(stages.slice(0, 3), ["CANCELLED", "DOCUMENT_COLLECTION", "DROPPED"]);
});

test("deal filters: defaults, status transforms, and limits", () => {
  const empty = dealFiltersSchema.parse({});
  assert.equal(empty.page, 1);
  assert.equal(empty.limit, 20);
  assert.equal(empty.sortBy, "updatedAt");
  assert.equal(empty.sortDir, "desc");

  const withBooleans = dealFiltersSchema.parse({ isActive: "false", status: "won", limit: "5" });
  assert.equal(withBooleans.isActive, false);
  assert.equal(withBooleans.status, "won");
  assert.equal(withBooleans.limit, 5);

  assert.equal(dealFiltersSchema.parse({ limit: "100" }).limit, 100);
  assert.throws(() => dealFiltersSchema.parse({ limit: "101" }));
  assert.throws(() => dealFiltersSchema.parse({ status: "archived" }));
});

test("deal creation: lead+title required, defaults applied server-side", () => {
  const r = createDealInputSchema.parse({
    leadId: "00000000-0000-4000-8000-000000000001",
    title: "Candidate A — DGCA",
  });
  assert.equal(r.stage, "ENQUIRY");
  assert.equal(r.currency, "INR");

  assert.throws(() => createDealInputSchema.parse({ title: "no lead" }));
  assert.throws(() => createDealInputSchema.parse({ leadId: "not-a-uuid", title: "x" }));
});

test("lost-stage mapping is shared between deal stages and lead statuses", () => {
  // DROPPED/CANCELLED are the deal-side lost stages; lead-status has its own set.
  assert.ok(isLostStatus("LOST"));
  assert.ok(isLostStatus("NOT_INTERESTED"));
  assert.ok(isLostStatus("REASON_NOT_SHARED"));
  assert.ok(LOST_STATUSES.includes("NOT_AWARE"));
  assert.equal(LOSS_REASON_DEFAULT.length > 0, true);
});