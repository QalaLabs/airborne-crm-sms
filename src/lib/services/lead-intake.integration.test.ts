/**
 * Lead intake + meetings feedback (walk-in source, initial status, CSV export,
 * IST created-date filter, meeting mode, Agent Calling week) against a
 * disposable PostgreSQL database. Gated by SECTION5_INTEGRATION=1.
 *
 *   npm run test:local
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { LeadStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { LeadService } from "@/lib/services/lead.service";
import { AgentCallingService } from "@/lib/services/agent-calling.service";
import { LeadRepository } from "@/lib/repositories/lead.repository";
import { applyLeadReadScope } from "@/lib/leads/lead-scope";
import { csvLine, leadExportPreamble, leadExportRow } from "@/lib/leads/lead-export";
import { parseISTWeek, shiftISTWeek } from "@/lib/leads/ist-week";
import { readMeetingMode } from "@/lib/crm/meeting-mode";
import { guard } from "@/lib/middleware/permissions";
import { ForbiddenError, ValidationError } from "@/lib/utils/errors";
import { createLeadSchema, leadFiltersSchema } from "@/lib/validations/lead.schema";
import type { RequestContext } from "@/types";

const ENABLED = process.env.SECTION5_INTEGRATION === "1";

let SEQ = 0;
const next = () => `${Date.now()}-${(SEQ++).toString(36)}`;
let PHONE = Math.floor(Math.random() * 1e6);
const phone = () => `93${Date.now().toString().slice(-5)}${String(PHONE++).padStart(6, "0")}`.slice(0, 15);

function ctx(orgId: string, userId: string, role: UserRole = "ADMIN"): RequestContext {
  return {
    orgId,
    user: { id: userId, orgId, campusId: null, name: `T ${role}`, email: `${userId}@example.com`, role, avatarUrl: null },
    requestId: randomUUID(),
    ipAddress: "127.0.0.1",
    userAgent: "node:test",
  };
}

async function seedOrg(label: string) {
  const suffix = next();
  const org = await prisma.organization.create({ data: { name: `${label}-${suffix}`, slug: `${label.toLowerCase()}-${suffix}` } });
  const mk = (role: UserRole, tag: string) =>
    prisma.user.create({ data: { orgId: org.id, name: `${tag} ${suffix}`, email: `${tag}-${suffix}@example.com`, role, passwordHash: null } });
  const admin = await mk("ADMIN", "admin");
  const counselorA = await mk("ADMISSIONS_COUNSELOR", "ca");
  const counselorB = await mk("ADMISSIONS_COUNSELOR", "cb");
  return { org, admin, counselorA, counselorB, suffix };
}

async function rawLead(orgId: string, over: Partial<{ name: string; status: LeadStatus; assignedTo: string | null; createdAt: Date; nextFollowUp: Date | null; source: "WALK_IN" | "DIRECT" | "GOOGLE_ADS" }> = {}) {
  return prisma.lead.create({
    data: {
      orgId,
      name: over.name ?? `Lead ${next()}`,
      phone: phone(),
      status: over.status ?? "NEW",
      source: over.source ?? "DIRECT",
      assignedTo: over.assignedTo ?? null,
      ...(over.createdAt ? { createdAt: over.createdAt } : {}),
      ...(over.nextFollowUp !== undefined ? { nextFollowUp: over.nextFollowUp } : {}),
    },
  });
}

async function exportCsv(orgId: string, raw: Record<string, string>, user: RequestContext["user"], batchSize = 2) {
  const { page: _p, limit: _l, ...parsed } = leadFiltersSchema.parse(raw);
  const filters = applyLeadReadScope(user, parsed);
  let csv = leadExportPreamble();
  let rows = 0;
  for await (const batch of LeadRepository.iterateForExport(orgId, filters, batchSize)) {
    for (const lead of batch) {
      csv += csvLine(leadExportRow(lead));
      rows++;
    }
  }
  return { csv, rows, total: await LeadRepository.countForExport(orgId, filters) };
}

// ── A1 ─────────────────────────────────────────────────────────────
test("A1: walk-in lead is saved, listed, filterable, preserved on edit and org-isolated", { skip: !ENABLED }, async () => {
  const s = await seedOrg("WalkIn");
  const other = await seedOrg("WalkInOther");
  const actor = ctx(s.org.id, s.admin.id);

  const input = createLeadSchema.parse({ name: `Walker ${s.suffix}`, phone: phone(), source: "WALK_IN" });
  const lead = await LeadService.create(actor, input);
  assert.equal(lead.source, "WALK_IN");
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).source, "WALK_IN");

  await rawLead(s.org.id, { source: "GOOGLE_ADS" });
  const filtered = await LeadService.list(actor, leadFiltersSchema.parse({ source: "WALK_IN" }));
  assert.deepEqual(filtered.data.map((l) => l.id), [lead.id]);
  assert.equal(filtered.total, 1);

  await LeadService.update(actor, lead.id, { name: `Walker Renamed ${s.suffix}`, city: "Delhi" });
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).source, "WALK_IN");

  const otherList = await LeadService.list(ctx(other.org.id, other.admin.id), leadFiltersSchema.parse({ source: "WALK_IN" }));
  assert.equal(otherList.total, 0);
});

// ── A3 ─────────────────────────────────────────────────────────────
test("A3: initial status is persisted with STATUS_CHANGE activity and audit", { skip: !ENABLED }, async () => {
  const s = await seedOrg("InitStatus");
  const actor = ctx(s.org.id, s.admin.id);
  const lead = await LeadService.create(actor, createLeadSchema.parse({ name: `Init ${s.suffix}`, phone: phone(), status: "CALL_BACK" }));
  assert.equal(lead.status, "CALL_BACK");

  const change = await prisma.leadActivity.findFirst({ where: { leadId: lead.id, activityType: "STATUS_CHANGE" } });
  assert.ok(change, "STATUS_CHANGE activity recorded");
  const audits = await prisma.auditLog.findMany({ where: { entityId: lead.id }, select: { action: true } });
  assert.ok(audits.some((a) => a.action === "lead.created"));
  assert.ok(audits.some((a) => a.action === "lead.status_changed"));
});

test("A3: NEW initial status creates no status change; counselor initial status stays self-assigned", { skip: !ENABLED }, async () => {
  const s = await seedOrg("InitStatusNew");
  const plain = await LeadService.create(ctx(s.org.id, s.admin.id), createLeadSchema.parse({ name: "Plain", phone: phone(), status: "NEW" }));
  assert.equal(plain.status, "NEW");
  assert.equal(await prisma.leadActivity.count({ where: { leadId: plain.id, activityType: "STATUS_CHANGE" } }), 0);

  const counselor = ctx(s.org.id, s.counselorA.id, "ADMISSIONS_COUNSELOR");
  const mine = await LeadService.create(counselor, createLeadSchema.parse({ name: "Mine", phone: phone(), status: "INTERESTED" }));
  assert.equal(mine.status, "INTERESTED");
  assert.equal(mine.assignedTo, s.counselorA.id);
});

test("A3: restricted initial statuses are rejected by the service and nothing is created", { skip: !ENABLED }, async () => {
  const s = await seedOrg("InitStatusBad");
  const actor = ctx(s.org.id, s.admin.id);
  for (const status of ["WON", "CONVERTED", "PROSPECT", "LOST"] as LeadStatus[]) {
    const p = phone();
    await assert.rejects(
      LeadService.create(actor, { name: "Bad", phone: p, source: "DIRECT", status }),
      (err: unknown) => err instanceof ValidationError,
      status,
    );
    assert.equal(await prisma.lead.count({ where: { orgId: s.org.id, phone: p } }), 0, status);
  }
});

// ── A2 ─────────────────────────────────────────────────────────────
test("A2: export covers the full filtered set across batches with escaping and injection protection", { skip: !ENABLED }, async () => {
  const s = await seedOrg("Export");
  const other = await seedOrg("ExportOther");
  const admin = ctx(s.org.id, s.admin.id).user;

  await rawLead(s.org.id, { name: "=HYPERLINK(\"http://evil\")", assignedTo: s.counselorA.id });
  await rawLead(s.org.id, { name: 'Rao, "Captain"', assignedTo: s.counselorA.id, status: "CALL_BACK" });
  await rawLead(s.org.id, { name: "अर्जुन", assignedTo: s.counselorB.id });
  await rawLead(s.org.id, { name: "Lost One", status: "LOST" });
  await rawLead(s.org.id, { name: "Fifth", source: "WALK_IN" });
  await rawLead(other.org.id, { name: "Other Org Secret" });

  const all = await exportCsv(s.org.id, {}, admin);
  assert.equal(all.rows, 5);
  assert.equal(all.total, 5);
  assert.ok(all.csv.startsWith("\uFEFF"));
  assert.ok(all.csv.includes(`"'=HYPERLINK(""http://evil"")"`));
  assert.ok(all.csv.includes('"Rao, ""Captain"""'));
  assert.ok(all.csv.includes("अर्जुन"));
  assert.ok(!all.csv.includes("Other Org Secret"), "org isolation");

  const active = await exportCsv(s.org.id, { isActive: "true" }, admin);
  assert.equal(active.rows, 4);
  assert.ok(!active.csv.includes("Lost One"));

  const status = await exportCsv(s.org.id, { status: "CALL_BACK" }, admin);
  assert.equal(status.rows, 1);

  const search = await exportCsv(s.org.id, { search: "Fifth" }, admin);
  assert.equal(search.rows, 1);

  const empty = await exportCsv(s.org.id, { search: "no-such-lead-anywhere" }, admin);
  assert.equal(empty.rows, 0);
  assert.equal(empty.csv, leadExportPreamble());
});

test("A2: counselor scope cannot be widened and export permission is enforced", { skip: !ENABLED }, async () => {
  const s = await seedOrg("ExportScope");
  await rawLead(s.org.id, { name: "A-owned", assignedTo: s.counselorA.id });
  await rawLead(s.org.id, { name: "B-owned", assignedTo: s.counselorB.id });

  const counselorA = ctx(s.org.id, s.counselorA.id, "ADMISSIONS_COUNSELOR").user;
  const scoped = await exportCsv(s.org.id, { assignedTo: s.counselorB.id }, counselorA);
  assert.equal(scoped.rows, 1);
  assert.ok(scoped.csv.includes("A-owned"));
  assert.ok(!scoped.csv.includes("B-owned"));

  for (const role of ["ADMISSIONS_COUNSELOR", "SUPPORT_STAFF", "CONTENT_MANAGER", "PLACEMENT_MANAGER"] as UserRole[]) {
    const user = ctx(s.org.id, s.admin.id, role).user;
    assert.throws(
      () => {
        guard(user, "read", "leads");
        guard(user, "export", "leads");
      },
      ForbiddenError,
      role,
    );
  }
  for (const role of ["ADMIN", "SUPER_ADMIN", "MARKETING_MANAGER"] as UserRole[]) {
    assert.doesNotThrow(() => guard(ctx(s.org.id, s.admin.id, role).user, "export", "leads"), role);
  }
});

// ── C1 ─────────────────────────────────────────────────────────────
test("C1: created-date filter uses IST day boundaries, runs before pagination and combines with filters", { skip: !ENABLED }, async () => {
  const s = await seedOrg("DateFilter");
  const actor = ctx(s.org.id, s.admin.id);
  const beforeDay = await rawLead(s.org.id, { name: "before", createdAt: new Date("2026-09-30T18:29:59.999Z") });
  const dayStart = await rawLead(s.org.id, { name: "day-start", createdAt: new Date("2026-09-30T18:30:00.000Z") });
  const dayEnd = await rawLead(s.org.id, { name: "day-end", status: "CALL_BACK", createdAt: new Date("2026-10-01T18:29:59.999Z") });
  const afterDay = await rawLead(s.org.id, { name: "after", createdAt: new Date("2026-10-01T18:30:00.000Z") });

  const sameDay = await LeadService.list(actor, leadFiltersSchema.parse({ dateFrom: "2026-10-01", dateTo: "2026-10-01" }));
  assert.deepEqual(new Set(sameDay.data.map((l) => l.id)), new Set([dayStart.id, dayEnd.id]));
  assert.equal(sameDay.total, 2);

  const page2 = await LeadService.list(actor, leadFiltersSchema.parse({ dateFrom: "2026-10-01", dateTo: "2026-10-01", limit: "1", page: "2" }));
  assert.equal(page2.total, 2, "total counts the filtered set, not the page");
  assert.equal(page2.data.length, 1);
  assert.equal(page2.data[0]!.id, dayStart.id, "createdAt desc: day-end on page 1, day-start on page 2");

  const combined = await LeadService.list(actor, leadFiltersSchema.parse({ dateFrom: "2026-10-01", dateTo: "2026-10-01", status: "CALL_BACK" }));
  assert.deepEqual(combined.data.map((l) => l.id), [dayEnd.id]);

  const openStart = await LeadService.list(actor, leadFiltersSchema.parse({ dateFrom: "2026-10-02" }));
  assert.deepEqual(openStart.data.map((l) => l.id), [afterDay.id]);

  const openEnd = await LeadService.list(actor, leadFiltersSchema.parse({ dateTo: "2026-09-30" }));
  assert.deepEqual(openEnd.data.map((l) => l.id), [beforeDay.id]);

  const none = await LeadService.list(actor, leadFiltersSchema.parse({ dateFrom: "2025-01-01", dateTo: "2025-01-31" }));
  assert.equal(none.total, 0);

  const exported = await exportCsv(s.org.id, { dateFrom: "2026-10-01", dateTo: "2026-10-01" }, actor.user);
  assert.equal(exported.rows, 2, "export honours the same date filter");

  assert.equal(leadFiltersSchema.safeParse({ dateFrom: "2026-10-02", dateTo: "2026-10-01" }).success, false);
});

// ── B1 ─────────────────────────────────────────────────────────────
test("B1: Online, Offline and Campus Visit modes persist; legacy meetings stay readable", { skip: !ENABLED }, async () => {
  const s = await seedOrg("MeetingMode");
  const actor = ctx(s.org.id, s.admin.id);
  const lead = await rawLead(s.org.id, { assignedTo: s.counselorA.id });
  const dueAt = new Date(Date.now() + 3_600_000).toISOString();

  for (const mode of ["ONLINE", "OFFLINE", "CAMPUS_VISIT"] as const) {
    const m = await LeadService.scheduleMeeting(actor, lead.id, { title: `Mode ${mode}`, dueAt, mode });
    const stored = await prisma.leadActivity.findUniqueOrThrow({ where: { id: m.id } });
    assert.equal(readMeetingMode(stored.metadata), mode);
  }

  const legacy = await prisma.leadActivity.create({
    data: { leadId: lead.id, orgId: s.org.id, activityType: "MEETING", title: "Legacy", dueAt: new Date(dueAt) },
  });
  assert.equal(readMeetingMode(legacy.metadata), null);

  const noMode = await LeadService.scheduleMeeting(actor, lead.id, { title: "No mode", dueAt, metadata: { room: "B2" } });
  assert.deepEqual(noMode.metadata, { room: "B2" });

  const changed = await LeadService.updateMeeting(actor, lead.id, noMode.id, { mode: "CAMPUS_VISIT" });
  assert.deepEqual(changed.metadata, { room: "B2", mode: "CAMPUS_VISIT" });

  const retitled = await LeadService.updateMeeting(actor, lead.id, noMode.id, { title: "Renamed" });
  assert.equal(readMeetingMode(retitled.metadata), "CAMPUS_VISIT", "editing other fields keeps the mode");

  const legacyEdited = await LeadService.updateMeeting(actor, lead.id, legacy.id, { mode: "OFFLINE" });
  assert.equal(readMeetingMode(legacyEdited.metadata), "OFFLINE", "legacy meeting can be given a mode later");
});

// ── C2 ─────────────────────────────────────────────────────────────
test("C2: Agent Calling returns one IST week of new leads and follow-ups, newest first, counselor-scoped", { skip: !ENABLED }, async () => {
  const s = await seedOrg("AgentCalling");
  const other = await seedOrg("AgentCallingOther");
  const week = parseISTWeek("2026-09-28")!; // Mon 28 Sep – Sun 4 Oct 2026 IST

  const newMonStart = await rawLead(s.org.id, { name: "new-mon", assignedTo: s.counselorA.id, createdAt: new Date("2026-09-27T18:30:00.000Z") });
  const newSunEnd = await rawLead(s.org.id, { name: "new-sun", assignedTo: s.counselorA.id, createdAt: new Date("2026-10-04T18:29:59.999Z") });
  const newOtherCounselor = await rawLead(s.org.id, { name: "new-b", assignedTo: s.counselorB.id, createdAt: new Date("2026-09-30T06:00:00.000Z") });
  await rawLead(s.org.id, { name: "new-prev-week", assignedTo: s.counselorA.id, createdAt: new Date("2026-09-27T18:29:59.999Z") });
  await rawLead(s.org.id, { name: "contacted-in-week", status: "CALL_BACK", assignedTo: s.counselorA.id, createdAt: new Date("2026-09-29T06:00:00.000Z") });

  const fuEarly = await rawLead(s.org.id, { name: "fu-early", status: "CALL_BACK", assignedTo: s.counselorA.id, nextFollowUp: new Date("2026-09-28T04:30:00.000Z") });
  const fuLate = await rawLead(s.org.id, { name: "fu-late", status: "INTERESTED", assignedTo: s.counselorA.id, nextFollowUp: new Date("2026-10-03T10:00:00.000Z") });
  await rawLead(s.org.id, { name: "fu-lost", status: "NOT_INTERESTED", assignedTo: s.counselorA.id, nextFollowUp: new Date("2026-10-01T10:00:00.000Z") });
  await rawLead(s.org.id, { name: "fu-next-week", status: "CALL_BACK", assignedTo: s.counselorA.id, nextFollowUp: new Date("2026-10-04T18:30:00.000Z") });
  await rawLead(other.org.id, { name: "other-org", assignedTo: null, createdAt: new Date("2026-09-30T06:00:00.000Z") });

  const adminView = await AgentCallingService.week(s.org.id, week);
  assert.deepEqual(adminView.newLeads.map((l) => l.id), [newSunEnd.id, newOtherCounselor.id, newMonStart.id]);
  assert.equal(adminView.newLeadsTotal, 3);
  assert.deepEqual(adminView.followUps.map((l) => l.id), [fuLate.id, fuEarly.id]);
  assert.equal(adminView.week.key, "2026-09-28");
  assert.equal(adminView.week.start, "2026-09-27T18:30:00.000Z");
  assert.equal(adminView.week.end, "2026-10-04T18:29:59.999Z");

  const counselorUser = ctx(s.org.id, s.counselorA.id, "ADMISSIONS_COUNSELOR").user;
  const { assignedTo } = applyLeadReadScope(counselorUser, { assignedTo: s.counselorB.id });
  const counselorView = await AgentCallingService.week(s.org.id, week, assignedTo);
  assert.deepEqual(counselorView.newLeads.map((l) => l.id), [newSunEnd.id, newMonStart.id]);
  assert.ok(counselorView.newLeads.every((l) => l.counselor?.id === s.counselorA.id));

  const prev = await AgentCallingService.week(s.org.id, shiftISTWeek(week, -1));
  assert.deepEqual(prev.newLeads.map((l) => l.name), ["new-prev-week"]);
  const nextWeek = await AgentCallingService.week(s.org.id, shiftISTWeek(week, 1));
  assert.deepEqual(nextWeek.followUps.map((l) => l.name), ["fu-next-week"]);
  assert.equal(nextWeek.newLeadsTotal, 0);
});
