/**
 * End-to-end CRM pipeline / Deal integration tests against a disposable
 * PostgreSQL database. Gated by DEALS_INTEGRATION=1 so the default `npm test`
 * run stays dependency-free. Requires the migration deployed:
 *
 *   $env:DEALS_INTEGRATION="1"; $env:DATABASE_URL="postgresql://postgres:postgres@localhost:5433/airbone_test?schema=public"; npx prisma generate --schema prisma/schema.prisma
 *   npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { DealService } from "@/lib/services/deal.service";
import { LeadService } from "@/lib/services/lead.service";
import { ValidationError, NotFoundError } from "@/lib/utils/errors";
import type { RequestContext } from "@/types";

const ENABLED = process.env.DEALS_INTEGRATION === "1";

const hasDetail = (err: unknown, re: RegExp) => {
  assert.ok(err instanceof ValidationError);
  const details = err.details as { message?: string }[];
  return details.some((d) => re.test(d.message ?? ""));
};

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
  requestId: `req-${orgId}`,
  ipAddress: "127.0.0.1",
  userAgent: "node:test",
});

async function seedOrg() {
  const suffix = next();
  const org = await prisma.organization.create({
    data: { name: `Deal-INT-${suffix}`, slug: `deal-int-${suffix}` },
  });
  const admin = await prisma.user.create({
    data: {
      orgId: org.id,
      name: "Deal Admin",
      email: `deal-admin-${suffix}@example.com`,
      role: "ADMIN",
      passwordHash: null,
    },
  });
  const counselor = await prisma.user.create({
    data: {
      orgId: org.id,
      name: "Deal Counselor",
      email: `deal-counselor-${suffix}@example.com`,
      role: "ADMISSIONS_COUNSELOR",
      passwordHash: null,
    },
  });
  const lead = await prisma.lead.create({
    data: {
      orgId: org.id,
      name: "Integ Prospect Candidate",
      phone: `91${suffix.replace(/[^0-9]/g, "").slice(-10)}`,
      courseInterest: "DGCA CPL Ground School",
      status: "NEW",
      score: 60,
    },
  });
  return { orgId: org.id, adminId: admin.id, counselorId: counselor.id, leadId: lead.id };
}

async function seedLead(orgId: string, name: string) {
  const suffix = next();
  return prisma.lead.create({
    data: {
      orgId,
      name,
      phone: `91${suffix.replace(/[^0-9]/g, "").slice(-10)}`,
      status: "NEW",
      score: 40,
    },
    select: { id: true },
  });
}

async function cleanup(orgId: string) {
  await Promise.all([
    prisma.activityFeedItem.deleteMany({ where: { orgId } }).catch(() => {}),
    prisma.internalEvent.deleteMany({ where: { orgId } }).catch(() => {}),
    prisma.eventLog.deleteMany({ where: { orgId } }).catch(() => {}),
    prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "orgId" = ${orgId}::uuid`.catch(() => {}),
  ]);
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
}

test("deal lifecycle: ensure idempotent, guarded transitions, won/lost markers, assign, pipeline, org isolation, convert, revert, delete, concurrent ensure", { skip: !ENABLED }, async () => {
  const { orgId, adminId, counselorId, leadId } = await seedOrg();
  const c = ctx(orgId, adminId);
  let extraOrgId: string | null = null;

  try {
    // 1. ensureDealForLead is idempotent (PROSPECT → Deal path).
    const first = await DealService.ensureDealForLead(c, leadId, {
      title: "Integ Candidate — DGCA CPL Ground School",
      source: "ORGANIC",
    });
    assert.equal(first.created, true);
    const second = await DealService.ensureDealForLead(c, leadId, {
      title: "Integ Candidate — DGCA CPL Ground School",
    });
    assert.equal(second.created, false);
    assert.equal(second.deal.id, first.deal.id, "second ensure must converge on the same deal");

    const dealId = first.deal.id;

    // 2. Guarded transitions: a legal forward move works; ENROLLED is terminal.
    const advanced = await DealService.update(c, dealId, { stage: "VERIFICATION" });
    assert.equal(advanced.stage, "VERIFICATION");

    const enrolled = await DealService.update(c, dealId, { stage: "ENROLLED" });
    assert.ok(enrolled.wonAt, "ENROLLED deal must be marked won");
    assert.ok(!enrolled.lostAt);

    // Terminal stages are closed: any further edit is rejected outright.
    await assert.rejects(
      DealService.update(c, dealId, { stage: "DOCUMENT_COLLECTION" }),
      (err) => hasDetail(err, /closed Lead Pipeline entry/),
    );

    // Closed deals reject non-stage edits entirely.
    await assert.rejects(
      DealService.update(c, dealId, { title: "Nope" }),
      (err) => hasDetail(err, /closed Lead Pipeline entry/),
    );

    // 4. Assign persists the owner.
    await DealService.assign(c, dealId, counselorId);
    const withOwner = await DealService.getById(c, dealId);
    assert.equal(withOwner.assignedTo, counselorId);

    // 5. Pipeline summary reflects the won deal.
    const summary = await DealService.getPipelineSummary(c);
    assert.equal(summary.wonCount, 1);
    assert.equal(summary.openCount, 0);

    // 6. Org isolation: a different org cannot read this deal.
    const orphanOrg = await prisma.organization.create({
      data: { name: `Other-${next()}`, slug: `other-${next()}` },
    });
    extraOrgId = orphanOrg.id;
    const otherUser = await prisma.user.create({
      data: {
        orgId: orphanOrg.id,
        name: "Other Admin",
        email: `other-${next()}@example.com`,
        role: "ADMIN",
        passwordHash: null,
      },
    });
    await assert.rejects(
      DealService.getById(ctx(orphanOrg.id, otherUser.id), dealId),
      (err) => err instanceof NotFoundError,
    );

    // 7. Convert to Admission: one deal → one admission, idempotent second call.
    const leadB = await seedLead(orgId, "Convert Candidate B");
    const dealB = await DealService.ensureDealForLead(c, leadB.id, { title: "Convert Candidate B — Prospect" });
    const conv = await DealService.convertToAdmission(c, dealB.deal.id, {});
    assert.equal(conv.created, true);
    assert.match(conv.admission.applicationNo, /^APP-/);

    const linkCheck = await DealService.getById(c, dealB.deal.id);
    assert.equal(linkCheck.admissionId, conv.admission.id);
    assert.ok(linkCheck.convertedAt, "convertedAt must be set");
    assert.ok(linkCheck.wonAt, "convert must also mark the deal won");
    assert.equal(linkCheck.stage, "ENROLLED");

    const convAgain = await DealService.convertToAdmission(c, dealB.deal.id, {});
    assert.equal(convAgain.created, false);
    assert.equal(convAgain.admission.id, conv.admission.id, "second convert returns the existing admission");

    const admissionCount = await prisma.admission.count({ where: { orgId, leadId: leadB.id } });
    assert.equal(admissionCount, 1, "only one admission may exist for a converted deal");

    // 8. Revert to Prospect reopens the same deal at ENQUIRY and restores the lead.
    await prisma.lead.update({
      where: { id: leadB.id, orgId },
      data: { status: "WON" },
    });
    const reverted = await DealService.revertToProspect(c, dealB.deal.id, { notes: "Test revert" });
    assert.equal(reverted.isActive, true, "reverted deal is reopened, not archived");
    assert.equal(reverted.stage, "ENQUIRY");
    assert.equal(reverted.wonAt, null, "revert must clear wonAt");
    assert.ok(reverted.revertedAt);
    await assert.rejects(
      DealService.revertToProspect(c, dealB.deal.id, {}),
      (err) => err instanceof ValidationError,
      "reverting a deal already at Prospect is rejected",
    );
    // M-08 Part B: revert clears the deal↔admission link + convertedAt (keeps admission).
    assert.equal(reverted.admissionId, null, "revert must clear the deal's admissionId link");
    assert.equal(reverted.convertedAt, null, "revert must clear convertedAt so the deal is no longer dangling");
    const retainedAdmission = await prisma.admission.findFirst({
      where: { id: conv.admission.id, orgId },
      select: { id: true },
    });
    assert.ok(retainedAdmission, "revert must KEEP the admission (non-destructive)");
    const restoredLead = await prisma.lead.findFirst({
      where: { id: leadB.id, orgId },
      select: { status: true },
    });
    assert.equal(restoredLead?.status, "PROSPECT", "revert must restore WON/CONVERTED leads to PROSPECT");

    // 9. Lost path persists lostAt + default reason.
    const leadC = await seedLead(orgId, "Lost Candidate C");
    const dealC = await DealService.ensureDealForLead(c, leadC.id, { title: "Lost Candidate C — Prospect" });
    const lost = await DealService.update(c, dealC.deal.id, { stage: "DROPPED" });
    assert.ok(lost.lostAt, "DROPPED deal must be marked lost");
    assert.ok(lost.lostReason, "lost deal requires a persisted reason");

    // 10. delete soft-deletes.
    const leadD = await seedLead(orgId, "Delete Candidate D");
    const dealD = await DealService.ensureDealForLead(c, leadD.id, {
      title: "Delete Candidate D — Prospect",
    });
    await DealService.delete(c, dealD.deal.id);
    await assert.rejects(DealService.getById(c, dealD.deal.id), (err) => err instanceof NotFoundError);

    // 11. Concurrent ensureDealForLead for the same lead converges to one deal.
    const leadE = await seedLead(orgId, "Concurrent Candidate E");
    const [r1, r2] = await Promise.all([
      DealService.ensureDealForLead(c, leadE.id, { title: "Concurrent E — Prospect" }),
      DealService.ensureDealForLead(c, leadE.id, { title: "Concurrent E — Prospect" }),
    ]);
    assert.equal(r1.deal.id, r2.deal.id, "concurrent ensure must converge on the same deal");
    const dealRows = await prisma.deal.count({ where: { orgId, leadId: leadE.id } });
    assert.equal(dealRows, 1, "exactly one deal row may exist per lead");

    // 12. Lead entering PROSPECT via the lead service auto-creates a deal.
    const leadF = await seedLead(orgId, "Prospect Auto Candidate F");
    const updatedLead = await LeadService.update(c, leadF.id, { status: "PROSPECT" });
    assert.ok(updatedLead, "lead update must return the lead");
    assert.equal(updatedLead.status, "PROSPECT");
    const autoDeal = await prisma.deal.findFirst({ where: { orgId, leadId: leadF.id } });
    assert.ok(autoDeal, "PROSPECT status must auto-open a deal");

    // 13. Illegal transitions at the lead level are rejected (WON is system-only).
    await assert.rejects(
      LeadService.update(c, leadF.id, { status: "WON" }),
      (err) => hasDetail(err, /Cannot transition lead/),
    );
  } finally {
    if (extraOrgId) await cleanup(extraOrgId);
    await cleanup(orgId);
  }
});