/**
 * M-03 remediation gate: an ADMISSIONS_COUNSELOR must only ever be able to see
 * their OWN leads, admissions, revenue/payments, activity, and per-counselor
 * performance. An ADMIN/SUPER_ADMIN continues to see the whole org.
 *
 * Pure unit test of the exported buildAnalyticsScope helper — no DB required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalyticsScope } from "@/lib/analytics/scope";

const ORG = "00000000-0000-0000-0000-00000000000a";
const COUNSELOR_ID = "00000000-0000-0000-0000-00000000000b";
const OTHER_ID = "00000000-0000-0000-0000-00000000000c";

test("M-03: counselor scopes every aggregate to their own records", () => {
  const s = buildAnalyticsScope({ id: COUNSELOR_ID, role: "ADMISSIONS_COUNSELOR" }, ORG);

  assert.equal(s.isCounselor, true);
  assert.deepEqual(s.leadWhere, { orgId: ORG, deletedAt: null, assignedTo: COUNSELOR_ID });
  assert.deepEqual(s.admissionWhere, { orgId: ORG, lead: { assignedTo: COUNSELOR_ID } });
  assert.deepEqual(s.paymentWhere, {
    orgId: ORG,
    status: "COMPLETED",
    admission: { lead: { assignedTo: COUNSELOR_ID } },
  });
  assert.deepEqual(s.activityWhere, { orgId: ORG, performedBy: COUNSELOR_ID });
  assert.deepEqual(s.counselorWhere, {
    orgId: ORG,
    role: "ADMISSIONS_COUNSELOR",
    isActive: true,
    deletedAt: null,
    id: COUNSELOR_ID,
  });
  assert.deepEqual(s.studentWhere, { orgId: ORG, deletedAt: null, lead: { assignedTo: COUNSELOR_ID } });
  assert.deepEqual(s.dealWhere, { orgId: ORG, deletedAt: null, assignedTo: COUNSELOR_ID });
});

test("M-03: admin/org-level role sees the entire org", () => {
  const s = buildAnalyticsScope({ id: OTHER_ID, role: "SUPER_ADMIN" }, ORG);

  assert.equal(s.isCounselor, false);
  assert.deepEqual(s.leadWhere, { orgId: ORG, deletedAt: null });
  assert.deepEqual(s.admissionWhere, { orgId: ORG });
  assert.deepEqual(s.paymentWhere, { orgId: ORG, status: "COMPLETED" });
  assert.deepEqual(s.activityWhere, { orgId: ORG });
  assert.deepEqual(s.counselorWhere, {
    orgId: ORG,
    role: "ADMISSIONS_COUNSELOR",
    isActive: true,
    deletedAt: null,
  });
  assert.deepEqual(s.studentWhere, { orgId: ORG, deletedAt: null });
  assert.deepEqual(s.dealWhere, { orgId: ORG, deletedAt: null });
});

test("M-03: counselor without an id is fail-closed (never degrades to org-wide)", () => {
  const s = buildAnalyticsScope({ id: "", role: "ADMISSIONS_COUNSELOR" }, ORG);

  // Role-based and fail-closed: even with a missing user id the counselor is
  // scoped to assignedTo (empty string matches nothing) instead of leaking the
  // whole org.
  assert.equal(s.isCounselor, true);
  assert.ok("assignedTo" in s.leadWhere, "lead scope must still be counselor-bound");
  assert.deepEqual((s.leadWhere as { assignedTo: string }).assignedTo, "");
  assert.ok(
    "assignedTo" in (s.dealWhere as Record<string, unknown>),
    "deal scope must still be counselor-bound",
  );
});
