import test from "node:test";
import assert from "node:assert/strict";
import { LeadRepository } from "@/lib/repositories/lead.repository";
import { prisma } from "@/lib/db/client";

test("Lead Visibility and Date Cutoff Regression Tests", async (t) => {
  const originalFindMany = prisma.lead.findMany;
  const originalCount = prisma.lead.count;

  let lastWhere: any;
  let lastOrderBy: any;
  let lastSkip: any;
  let lastTake: any;

  (prisma.lead as any).findMany = (args: any) => {
    lastWhere = args.where;
    lastOrderBy = args.orderBy;
    lastSkip = args.skip;
    lastTake = args.take;
    return Promise.resolve([{ id: 'mocked' }]);
  };
  (prisma.lead as any).count = (args: any) => Promise.resolve(1);

  await t.test("1 & 2. Lead created on 17/18 Aug appears (no hardcoded date cutoff)", async () => {
    await LeadRepository.findMany("org-1", { page: 1, limit: 20, sortBy: "createdAt", sortDir: "desc" });
    assert.equal(lastWhere.createdAt, undefined, "Should not have hardcoded date filters");
  });

  await t.test("5. Newest leads appear first", async () => {
    await LeadRepository.findMany("org-1", { page: 1, limit: 20, sortBy: "createdAt", sortDir: "desc" });
    assert.deepEqual(lastOrderBy, { createdAt: "desc" });
  });

  await t.test("6. Pagination does not exclude newer records", async () => {
    await LeadRepository.findMany("org-1", { page: 2, limit: 20, sortBy: "createdAt", sortDir: "desc" });
    assert.equal(lastSkip, 20);
    assert.equal(lastTake, 20);
    assert.equal(lastWhere.createdAt, undefined);
  });

  await t.test("7. Active Leads still works (isActive=true)", async () => {
    await LeadRepository.findMany("org-1", { page: 1, limit: 20, isActive: true, sortBy: "createdAt", sortDir: "desc" });
    assert.ok(Array.isArray(lastWhere.status.in), "Should filter by active statuses array");
    assert.ok(lastWhere.status.in.includes("NEW"));
  });

  await t.test("8. Status filters still work (status=LOST)", async () => {
    await LeadRepository.findMany("org-1", { page: 1, limit: 20, status: "LOST", sortBy: "createdAt", sortDir: "desc" });
    assert.equal(lastWhere.status, "LOST");
  });

  await t.test("9. Organization/tenant isolation still works", async () => {
    await LeadRepository.findMany("org-2", { page: 1, limit: 20, sortBy: "createdAt", sortDir: "desc" });
    assert.equal(lastWhere.orgId, "org-2");
  });

  (prisma.lead as any).findMany = originalFindMany;
  (prisma.lead as any).count = originalCount;
});
