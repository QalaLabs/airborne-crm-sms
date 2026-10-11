/**
 * Unified Timeline read-model tests (Section 5 fix verification) against a
 * disposable PostgreSQL database. Gated by SECTION5_INTEGRATION=1.
 *
 * The regression we guard: the old implementation reported an unbounded
 * `total` while only ever fetching up to 300 entries per source and forcing
 * every page to re-slice from a fixed 300-item window — losing entries on
 * deep pages and shuffling the stream between requests. The fix fetches
 * `min(cap(count), offset+limit)` per source, so `total` and `items` always
 * agree and pagination is deterministic.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { TimelineService } from "@/lib/services/timeline.service";
import { LeadService } from "@/lib/services/lead.service";
import type { RequestContext } from "@/types";

const ENABLED = process.env.SECTION5_INTEGRATION === "1";

let SEQ = 0;
const next = () => `${Date.now()}-${(SEQ++).toString(36)}`;

const ctx = (orgId: string, userId: string): RequestContext => ({
  orgId,
  user: { id: userId, orgId, campusId: null, name: "TL Admin", email: `tl-${next()}@example.com`, role: "ADMIN", avatarUrl: null },
  requestId: randomUUID(),
  ipAddress: "127.0.0.1",
  userAgent: "node:test",
});

async function seedOrg() {
  const suffix = next();
  const org = await prisma.organization.create({
    data: { name: `TL-INT-${suffix}`, slug: `tl-int-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { orgId: org.id, name: "TL Admin", email: `tl-admin-${suffix}@example.com`, role: "ADMIN", passwordHash: null },
  });
  const lead = await prisma.lead.create({
    data: {
      orgId: org.id,
      name: `Timeline Lead ${suffix}`,
      email: `tl-lead-${suffix}@example.com`,
      phone: `93${Date.now().toString().slice(-10)}`,
      status: "NEW",
    },
  });
  return { org, user, lead };
}

test("timeline: total is truthful and items are stable across pagination", { skip: !ENABLED }, async () => {
  const s = await seedOrg();
  const actor = ctx(s.org.id, s.user.id);

  // 7 CALL activities (sort desc) — enough to cross a limit boundary twice.
  for (let i = 0; i < 7; i++) {
    await prisma.leadActivity.create({
      data: {
        orgId: s.org.id,
        leadId: s.lead.id,
        performedBy: s.user.id,
        activityType: "NOTE",
        title: `Note ${i}`,
        completedAt: new Date(Date.now() + i * 1000),
        metadata: {},
      },
    });
  }

  // One notification log entry for the lead (entityType lower "lead").
  await prisma.notificationLog.create({
    data: {
      orgId: s.org.id,
      event: "NEW_LEAD",
      channel: "WHATSAPP",
      recipient: s.lead.phone,
      body: "welcome",
      status: "SENT",
      entityType: "lead",
      entityId: s.lead.id,
      sentAt: new Date(Date.now() - 5000),
    },
  });

  const page1 = await TimelineService.getTimeline(s.org.id, { entityType: "LEAD", entityId: s.lead.id, page: 1, limit: 3 });
  const page2 = await TimelineService.getTimeline(s.org.id, { entityType: "LEAD", entityId: s.lead.id, page: 2, limit: 3 });
  const page3 = await TimelineService.getTimeline(s.org.id, { entityType: "LEAD", entityId: s.lead.id, page: 3, limit: 3 });

  const total = page1.total;
  assert.ok(total >= 8, `total=${total} should cover activities + notification`);
  assert.equal(page1.items.length + page2.items.length + page3.items.length, total, "merged items cover the full truthful total");

  // No duplicate ids across pages; each page is internally sorted desc.
  const all = [...page1.items, ...page2.items, ...page3.items];
  const ids = all.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate entries across pages");

  const times = all.map((e) => new Date(e.at).getTime());
  for (let i = 1; i < times.length; i++) {
    const prev = times[i - 1];
    const cur = times[i];
    if (prev !== undefined && cur !== undefined) {
      assert.ok(prev >= cur, "stream is strictly newest-first");
    }
  }

  // Deterministic: the same page twice returns identical id sequences.
  const repeat = await TimelineService.getTimeline(s.org.id, { entityType: "LEAD", entityId: s.lead.id, page: 1, limit: 3 });
  assert.deepEqual(repeat.items.map((e) => e.id), page1.items.map((e) => e.id), "stable ordering between requests");
});

test("timeline: lead-scoped only returns that lead's entries (no cross-org bleed)", { skip: !ENABLED }, async () => {
  const s = await seedOrg();
  const s2 = await seedOrg();
  const actor = ctx(s.org.id, s.user.id);

  await prisma.leadActivity.create({
    data: { orgId: s.org.id, leadId: s.lead.id, performedBy: s.user.id, activityType: "NOTE", title: "Org A note", metadata: {} },
  });
  // Org B has its own lead/activity; must never surface in Org A's timeline.
  const actorB = ctx(s2.org.id, s2.user.id);
  await prisma.leadActivity.create({
    data: { orgId: s2.org.id, leadId: s2.lead.id, performedBy: s2.user.id, activityType: "NOTE", title: "Org B note", metadata: {} },
  });

  const a = await TimelineService.getTimeline(s.org.id, { entityType: "LEAD", entityId: s.lead.id, page: 1, limit: 20 });
  assert.equal(a.items.length, 1);
  assert.equal(a.items[0]?.title, "Org A note");
  assert.ok(a.items.every((e) => !e.title?.includes("Org B")));

  const b = await TimelineService.getTimeline(s2.org.id, { entityType: "LEAD", entityId: s2.lead.id, page: 1, limit: 20 });
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0]?.title, "Org B note");
});

test("timeline: scheduleMeeting shows as an activity entry with kind field", { skip: !ENABLED }, async () => {
  const s = await seedOrg();
  const actor = ctx(s.org.id, s.user.id);
  await LeadService.scheduleMeeting(actor, s.lead.id, {
    title: "TL Meeting",
    dueAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    durationMins: 30,
  });

  const res = await TimelineService.getTimeline(s.org.id, { entityType: "LEAD", entityId: s.lead.id, page: 1, limit: 20 });
  const meetingEntry = res.items.find((e) => e.kind === "activity");
  assert.ok(meetingEntry, "meeting shows up as an activity entry");
  assert.equal(meetingEntry?.status, null);
});