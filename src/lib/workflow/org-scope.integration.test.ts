/**
 * H-01 remediation gate: workflow action executors scope every lead mutation
 * by orgId. A run belonging to org A must never be able to mutate a lead
 * belonging to org B (cross-tenant write).
 *
 * Gated by WORKFLOW_INTEGRATION=1 (enabled by `npm run test:local`). Requires a
 * migrated database:
 *
 *   $env:WORKFLOW_INTEGRATION="1"; $env:DATABASE_URL="postgresql://..."; npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { executeAction } from "@/lib/workflow/actions";
import type { ActionContext } from "@/lib/workflow/types";

const ENABLED = process.env.WORKFLOW_INTEGRATION === "1";

function makeCtx(runId: string, orgId: string, leadId: string): ActionContext {
  return {
    orgId,
    runId,
    workflowId: "00000000-0000-0000-0000-000000000000",
    entityType: "lead",
    entityId: leadId,
    actorId: undefined,
    requestId: `req-${runId}`,
    idempotencyKey: `${runId}:0`,
    event: {},
  };
}

test(
  "H-01: workflow lead mutations are org-scoped — cross-org lead is never touched",
  { skip: !ENABLED },
  async () => {
    const orgA = await prisma.organization.create({
      data: { name: `ORG-A-${Date.now()}`, slug: `org-a-${Date.now()}` },
    });
    const orgB = await prisma.organization.create({
      data: { name: `ORG-B-${Date.now()}`, slug: `org-b-${Date.now()}` },
    });

    let counselorB: { id: string } | undefined;
    try {
      // Lead to be mutated (org B). The workflow run context belongs to org A.
      const target = await prisma.lead.create({
        data: { orgId: orgB.id, name: "OrgB Lead", phone: `91${Date.now().toString().slice(-10)}`, tags: [] },
        select: { id: true },
      });
      const counselor = await prisma.user.create({
        data: { orgId: orgB.id, name: "CounselorB", email: `counselor-b-${Date.now()}@example.com`, role: "ADMISSIONS_COUNSELOR", passwordHash: null },
        select: { id: true },
      });
      counselorB = counselor;

      const ctxA = makeCtx(`run-${Date.now()}`, orgA.id, target.id);
      const snapshot = { id: target.id, leadId: target.id, status: "NEW", tags: [] };

      // ASSIGN_LEAD — must be a no-op (no row matched) on the org-B lead.
      await executeAction({ type: "ASSIGN_LEAD", counselorId: counselor.id }, ctxA, snapshot);
      const afterAssign = await prisma.lead.findUnique({ where: { id: target.id }, select: { assignedTo: true } });
      assert.equal(afterAssign?.assignedTo, null, "cross-org ASSIGN_LEAD must not assign");

      // UPDATE_STATUS — must be a no-op.
      await executeAction({ type: "UPDATE_STATUS", status: "CONTACTED" }, ctxA, snapshot);
      const afterStatus = await prisma.lead.findUnique({ where: { id: target.id }, select: { status: true } });
      assert.equal(afterStatus?.status, "NEW", "cross-org UPDATE_STATUS must not change status");

      // ADD_TAG — must be a no-op.
      await executeAction({ type: "ADD_TAG", tag: "hot" }, ctxA, snapshot);
      const afterTag = await prisma.lead.findUnique({ where: { id: target.id }, select: { tags: true } });
      assert.deepEqual(afterTag?.tags, [], "cross-org ADD_TAG must not add tag");

      // UPDATE_LEAD — must be a no-op.
      await executeAction(
        { type: "UPDATE_LEAD", fields: { city: "Delhi", customFields: { stage: "x" } } },
        ctxA,
        snapshot,
      );
      const afterUpdate = await prisma.lead.findUnique({ where: { id: target.id }, select: { city: true, customFields: true } });
      assert.equal(afterUpdate?.city, null, "cross-org UPDATE_LEAD must not set city");

      // Sanity: the SAME action from an org-B context DOES mutate (guards aren't over-broad).
      const ctxB = makeCtx(`run-${Date.now()}`, orgB.id, target.id);
      await executeAction({ type: "ASSIGN_LEAD", counselorId: counselor.id }, ctxB, snapshot);
      const afterSameOrg = await prisma.lead.findUnique({ where: { id: target.id }, select: { assignedTo: true } });
      assert.equal(afterSameOrg?.assignedTo, counselor.id, "same-org ASSIGN_LEAD must assign");
    } finally {
      // Side-effect rows hold non-cascading FKs; clear before deleting orgs.
      await prisma.leadActivity.deleteMany({ where: { orgId: { in: [orgA.id, orgB.id] } } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { orgId: { in: [orgA.id, orgB.id] } } }).catch(() => {});
      await prisma.activityFeedItem.deleteMany({ where: { orgId: { in: [orgA.id, orgB.id] } } }).catch(() => {});
      await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } }).catch(() => {});
      if (counselorB) {
        await prisma.user.deleteMany({ where: { id: { in: [counselorB.id] } } }).catch(() => {});
      }
    }
  },
);
