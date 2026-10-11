import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { isActiveAdmissionStage, linkAdmissionToDeal } from "./deal-admission-link";

type DealRow = { id: string; orgId: string; admissionId: string | null };

function installMocks(deal: DealRow) {
  const cancelled: string[] = [];
  const orig = {
    updateMany: prisma.deal.updateMany,
    findFirst: prisma.deal.findFirst,
    admissionUpdate: prisma.admission.update,
  };
  (prisma.deal as any).updateMany = async (args: any) => {
    // Postgres semantics: WHERE re-evaluated against the latest committed row.
    await Promise.resolve();
    const w = args.where;
    if (w.id === deal.id && w.orgId === deal.orgId && w.admissionId === deal.admissionId) {
      deal.admissionId = args.data.admissionId;
      return { count: 1 };
    }
    return { count: 0 };
  };
  (prisma.deal as any).findFirst = async () => ({ admissionId: deal.admissionId });
  (prisma.admission as any).update = async (args: any) => {
    cancelled.push(args.where.id);
    return { id: args.where.id, stage: args.data.stage };
  };
  const restore = () => {
    (prisma.deal as any).updateMany = orig.updateMany;
    (prisma.deal as any).findFirst = orig.findFirst;
    (prisma.admission as any).update = orig.admissionUpdate;
  };
  return { cancelled, restore };
}

test("isActiveAdmissionStage excludes CANCELLED / DROPPED / empty", () => {
  assert.equal(isActiveAdmissionStage("ENQUIRY"), true);
  assert.equal(isActiveAdmissionStage("ENROLLED"), true);
  assert.equal(isActiveAdmissionStage("CANCELLED"), false);
  assert.equal(isActiveAdmissionStage("DROPPED"), false);
  assert.equal(isActiveAdmissionStage(null), false);
});

test("first converter links its admission", async () => {
  const deal: DealRow = { id: "d1", orgId: "o1", admissionId: null };
  const m = installMocks(deal);
  try {
    const r = await linkAdmissionToDeal({ orgId: "o1", dealId: "d1", expectedPrevious: null, admissionId: "a1" });
    assert.deepEqual(r, { linked: true, admissionId: "a1" });
    assert.equal(deal.admissionId, "a1");
    assert.deepEqual(m.cancelled, []);
  } finally {
    m.restore();
  }
});

test("concurrent converters: exactly one wins, loser archives its orphan and adopts the winner", async () => {
  const deal: DealRow = { id: "d1", orgId: "o1", admissionId: null };
  const m = installMocks(deal);
  try {
    const [r1, r2] = await Promise.all([
      linkAdmissionToDeal({ orgId: "o1", dealId: "d1", expectedPrevious: null, admissionId: "a1" }),
      linkAdmissionToDeal({ orgId: "o1", dealId: "d1", expectedPrevious: null, admissionId: "a2" }),
    ]);
    const winners = [r1, r2].filter((r) => r.linked);
    assert.equal(winners.length, 1, "exactly one link must succeed");
    const winnerId = winners[0]!.admissionId;
    const loser = r1.linked ? r2 : r1;
    assert.equal(loser.admissionId, winnerId, "loser must adopt the winner");
    assert.equal(deal.admissionId, winnerId);
    assert.equal(m.cancelled.length, 1);
    assert.notEqual(m.cancelled[0], winnerId, "only the orphan is archived");
  } finally {
    m.restore();
  }
});

test("re-conversion replaces a previously cancelled admission (expectedPrevious matches)", async () => {
  const deal: DealRow = { id: "d1", orgId: "o1", admissionId: "old-cancelled" };
  const m = installMocks(deal);
  try {
    const r = await linkAdmissionToDeal({ orgId: "o1", dealId: "d1", expectedPrevious: "old-cancelled", admissionId: "a3" });
    assert.equal(r.linked, true);
    assert.equal(deal.admissionId, "a3");
  } finally {
    m.restore();
  }
});

test("P2002 (admission already linked to another deal) is treated as a lost race", async () => {
  const deal: DealRow = { id: "d1", orgId: "o1", admissionId: "winner" };
  const m = installMocks(deal);
  (prisma.deal as any).updateMany = async () => {
    const err = new Error("Unique constraint") as Error & { code: string };
    err.code = "P2002";
    throw err;
  };
  try {
    const r = await linkAdmissionToDeal({ orgId: "o1", dealId: "d1", expectedPrevious: null, admissionId: "mine" });
    assert.deepEqual(r, { linked: false, admissionId: "winner" });
    assert.deepEqual(m.cancelled, ["mine"]);
  } finally {
    m.restore();
  }
});

test("non-P2002 errors propagate", async () => {
  const deal: DealRow = { id: "d1", orgId: "o1", admissionId: null };
  const m = installMocks(deal);
  (prisma.deal as any).updateMany = async () => {
    throw new Error("connection lost");
  };
  try {
    await assert.rejects(
      linkAdmissionToDeal({ orgId: "o1", dealId: "d1", expectedPrevious: null, admissionId: "x" }),
      /connection lost/,
    );
  } finally {
    m.restore();
  }
});
