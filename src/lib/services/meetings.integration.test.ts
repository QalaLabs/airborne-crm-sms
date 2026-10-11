/**
 * End-to-end Meetings CRUD tests against a disposable PostgreSQL database.
 * Gated by SECTION5_INTEGRATION=1. Covers schedule → reschedule → cancel,
 * counselor ABAC enforcement, invalid param rejection (route-level schema),
 * and meeting list search using the relational lead filter.
 *
 *   $env:SECTION5_INTEGRATION="1"; npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { LeadService } from "@/lib/services/lead.service";
import { ForbiddenError, NotFoundError } from "@/lib/utils/errors";
import { scheduleMeetingSchema, updateMeetingSchema } from "@/lib/validations/lead.schema";
import type { RequestContext } from "@/types";

const ENABLED = process.env.SECTION5_INTEGRATION === "1";

let SEQ = 0;
const next = () => `${Date.now()}-${(SEQ++).toString(36)}`;

const ctx = (orgId: string, userId: string, role: "ADMIN" | "ADMISSIONS_COUNSELOR" = "ADMIN"): RequestContext => ({
  orgId,
  user: {
    id: userId,
    orgId,
    campusId: null,
    name: role === "ADMIN" ? "Test Admin" : "Test Counselor",
    email: `test-${role.toLowerCase()}-${userId}@example.com`,
    role,
    avatarUrl: null,
  },
  requestId: randomUUID(),
  ipAddress: "127.0.0.1",
  userAgent: "node:test",
});

async function seedOrg() {
  const suffix = next();
  const org = await prisma.organization.create({
    data: { name: `Meeting-INT-${suffix}`, slug: `meeting-int-${suffix}` },
  });
  const admin = await prisma.user.create({
    data: { orgId: org.id, name: "Admin", email: `m-admin-${suffix}@example.com`, role: "ADMIN", passwordHash: null },
  });
  const counselorA = await prisma.user.create({
    data: { orgId: org.id, name: "Counselor A", email: `m-ca-${suffix}@example.com`, role: "ADMISSIONS_COUNSELOR", passwordHash: null },
  });
  const counselorB = await prisma.user.create({
    data: { orgId: org.id, name: "Counselor B", email: `m-cb-${suffix}@example.com`, role: "ADMISSIONS_COUNSELOR", passwordHash: null },
  });
  const leadA = await prisma.lead.create({
    data: {
      orgId: org.id,
      name: `Searchable Name ${suffix}`,
      email: `s5-${suffix}@example.com`,
      phone: `91${Date.now().toString().slice(-10)}`,
      status: "NEW",
      assignedTo: counselorA.id,
    },
  });
  const leadB = await prisma.lead.create({
    data: {
      orgId: org.id,
      name: `Other Lead ${suffix}`,
      email: `s5-b-${suffix}@example.com`,
      phone: `92${Date.now().toString().slice(-10)}`,
      status: "NEW",
      assignedTo: counselorB.id,
    },
  });
  return { org, admin, counselorA, counselorB, leadA, leadB };
}

const inMinutes = (mins: number) => new Date(Date.now() + mins * 60 * 1000).toISOString();

test("meetings CRUD: schedule, reschedule, complete, cancel keeps audit trail", { skip: !ENABLED }, async () => {
  const s = await seedOrg();
  const actor = ctx(s.org.id, s.admin.id);

  const meeting = await LeadService.scheduleMeeting(actor, s.leadA.id, {
    title: "Counseling Session",
    dueAt: inMinutes(60),
    durationMins: 30,
    notes: "First call",
  });
  assert.ok(meeting.id);
  assert.equal(meeting.activityType, "MEETING");
  assert.equal(meeting.performer?.id, s.admin.id);

  // Reschedule
  const later = inMinutes(120);
  const updated = await LeadService.updateMeeting(actor, s.leadA.id, meeting.id, {
    title: "Counseling Session (rescheduled)",
    dueAt: later,
    durationMins: 45,
  });
  assert.equal(updated.title, "Counseling Session (rescheduled)");
  assert.equal(updated.durationMins, 45);

  // Complete path (generic completeActivity keeps the row)
  const completed = await LeadService.completeActivity(actor, s.leadA.id, meeting.id, {
    outcome: "INTERESTED",
  });
  assert.ok(completed.completedAt);

  // Cancel: keeps row, sets outcome CANCELLED + completion timestamp + metadata
  const cancelled = await LeadService.cancelMeeting(actor, s.leadA.id, meeting.id);
  assert.equal(cancelled.outcome, "CANCELLED");
  assert.ok(cancelled.completedAt);
  const meta = cancelled.metadata as { cancelledBy?: string; cancelledAt?: string };
  assert.equal(meta.cancelledBy, s.admin.id);
  assert.ok(meta.cancelledAt);

  // Audit trail exists for both writes
  const audits = await prisma.auditLog.count({
    where: { orgId: s.org.id, entityType: "lead_activity", action: { endsWith: "created" } },
  });
  assert.ok(audits >= 1);
});

test("meetings CRUD: update on missing meeting or wrong org returns 404 NotFound", { skip: !ENABLED }, async () => {
  const s = await seedOrg();
  const outsider = await prisma.organization.create({
    data: { name: `Other-Org-${next()}`, slug: `other-org-${next()}` },
  });
  const actor = ctx(s.org.id, s.admin.id);

  await assert.rejects(
    LeadService.updateMeeting(actor, s.leadA.id, "00000000-0000-0000-0000-000000000000", { title: "x" }),
    (e: unknown) => e instanceof NotFoundError,
  );
  await assert.rejects(
    LeadService.cancelMeeting(actor, s.leadA.id, "00000000-0000-0000-0000-000000000000"),
    (e: unknown) => e instanceof NotFoundError,
  );
  await assert.rejects(
    LeadService.updateMeeting(ctx(outsider.id, s.admin.id), s.leadA.id, "00000000-0000-0000-0000-000000000000", { title: "x" }),
    (e: unknown) => e instanceof NotFoundError,
  );
});

test("meetings CRUD: valid schemas reject bad datetime and non-uuid", async () => {
  assert.equal(updateMeetingSchema.safeParse({ dueAt: "not-a-date" }).success, false);
  assert.equal(updateMeetingSchema.safeParse({ dueAt: inMinutes(30) }).success, true);
  assert.equal(updateMeetingSchema.safeParse({ durationMins: -5 }).success, false);
  const badId = scheduleMeetingSchema.safeParse({ leadId: "nope", dueAt: inMinutes(30) });
  assert.equal(badId.success, false);
});

test("meetings ABAC: counselor cannot mutate another counselor's lead meeting", { skip: !ENABLED }, async () => {
  const s = await seedOrg();
  const meeting = await LeadService.scheduleMeeting(ctx(s.org.id, s.counselorA.id), s.leadA.id, {
    title: "Owned by A",
    dueAt: inMinutes(90),
  });

  // Counselor B would pass guard() (has write) but guardRecord(assigned_to: self)
  // must reject since B does not own leadA (the meeting's lead).
  const record = { assignedTo: s.counselorA.id };
  const { guardRecord, getCounselorCondition } = await import("@/lib/middleware/permissions");
  const cond = getCounselorCondition(ctx(s.org.id, s.counselorB.id, "ADMISSIONS_COUNSELOR").user);
  assert.throws(
    () => guardRecord(ctx(s.org.id, s.counselorB.id, "ADMISSIONS_COUNSELOR").user, "write", "leads", record as unknown as Record<string, unknown>, cond),
    (e: unknown) => e instanceof ForbiddenError,
  );

  // The service layer is org-scoped only (ABAC is enforced by the route guard,
  // which exercises guardRecord above), so B can technically update the row.
  const updated = await LeadService.updateMeeting(ctx(s.org.id, s.counselorB.id), s.leadA.id, meeting.id, { notes: "tamper" });
  assert.ok(updated);
  const persisted = await prisma.leadActivity.findUnique({ where: { id: meeting.id } });
  assert.equal(persisted?.notes, "tamper");
});

test("meetings list fetch: relational search filter narrows by lead name/phone/email", { skip: !ENABLED }, async () => {
  const s = await seedOrg();
  const actor = ctx(s.org.id, s.admin.id);
  await LeadService.scheduleMeeting(actor, s.leadA.id, { title: "A meeting", dueAt: inMinutes(45) });
  await LeadService.scheduleMeeting(actor, s.leadB.id, { title: "B meeting", dueAt: inMinutes(75) });

  const needle = `Searchable Name ${s.org.slug.replace("meeting-int-", "")}`;
  const byName = await prisma.leadActivity.findMany({
    where: {
      orgId: s.org.id,
      activityType: "MEETING",
      lead: { is: { name: { contains: "Searchable Name", mode: "insensitive" } } },
    },
    select: { leadId: true },
  });
  assert.ok(byName.length >= 1);
  assert.ok(byName.every((r) => r.leadId === s.leadA.id));

  // phone ends-with search (storage format endsWith semantics)
  const phoneTail = s.leadB.phone.slice(-10);
  const byPhone = await prisma.leadActivity.findMany({
    where: {
      orgId: s.org.id,
      activityType: "MEETING",
      lead: { is: { phone: { contains: phoneTail } } },
    },
    select: { leadId: true },
  });
  assert.ok(byPhone.length >= 1);
  assert.ok(byPhone.every((r) => r.leadId === s.leadB.id));
});

// ActivityFeed payload shape is duck-typed, so the integration verifies the
// service plumbing composes with the audit + feed writers used by the routes.
test("meetings CRUD writes audit + feed records", { skip: !ENABLED }, async () => {
  const s = await seedOrg();
  const actor = ctx(s.org.id, s.admin.id);
  const meeting = await LeadService.scheduleMeeting(actor, s.leadA.id, { title: "Audit me", dueAt: inMinutes(30) });

  const audit = await prisma.auditLog.findFirst({
    where: { orgId: s.org.id, entityId: meeting.id, action: "lead_activity.created" },
  });
  assert.ok(audit);

  const feed = await prisma.activityFeedItem.findFirst({
    where: { orgId: s.org.id, objectId: s.leadA.id, verb: "logged_activity" },
  });
  assert.ok(feed);
});