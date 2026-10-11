import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { UserRepository } from "./user.repository";

const ORG = "00000000-0000-4000-8000-0000000000aa";

type Row = Record<string, any> & { id: string; email: string; orgId: string; deletedAt: Date | null };

function harness(rows: Row[]) {
  const orig = { findFirst: prisma.user.findFirst, create: prisma.user.create, update: prisma.user.update };
  const calls = { create: 0, update: 0 };
  (prisma.user as any).findFirst = async (a: any) =>
    rows.find(
      (r) =>
        r.email === a.where.email &&
        r.orgId === a.where.orgId &&
        (a.where.deletedAt?.not === null ? r.deletedAt !== null : r.deletedAt === null),
    ) ?? null;
  (prisma.user as any).create = async (a: any) => {
    calls.create++;
    if (rows.some((r) => r.email === a.data.email && r.orgId === a.data.orgId)) {
      throw new Error("Unique constraint failed on the fields: (`email`,`orgId`)");
    }
    const row = { id: `u-${rows.length + 1}`, deletedAt: null, ...a.data };
    rows.push(row);
    return row;
  };
  (prisma.user as any).update = async (a: any) => {
    calls.update++;
    const row = rows.find((r) => r.id === a.where.id)!;
    Object.assign(row, a.data);
    return row;
  };
  return {
    calls,
    restore() {
      (prisma.user as any).findFirst = orig.findFirst;
      (prisma.user as any).create = orig.create;
      (prisma.user as any).update = orig.update;
    },
  };
}

test("create restores a soft-deleted account with the same email instead of hitting the unique constraint", async () => {
  const rows: Row[] = [
    {
      id: "old",
      orgId: ORG,
      email: "pilot@example.com",
      name: "Old Name",
      role: "TEACHER",
      passwordHash: "old-hash",
      isMfaEnabled: true,
      mfaSecret: "secret",
      isActive: false,
      deletedAt: new Date("2026-09-01"),
    },
  ];
  const h = harness(rows);
  try {
    const user = await UserRepository.create(ORG, {
      email: "Pilot@Example.com",
      name: "New Name",
      role: "SUPPORT_STAFF",
      inviteToken: "hashed-token",
      inviteExpiry: new Date("2026-10-09"),
      isActive: false,
    });
    assert.equal(user.id, "old");
    assert.equal(h.calls.create, 0);
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.deletedAt, null);
    assert.equal(row.name, "New Name");
    assert.equal(row.role, "SUPPORT_STAFF");
    assert.equal(row.passwordHash, null, "old password must not survive a re-invite");
    assert.equal(row.isMfaEnabled, false);
    assert.equal(row.mfaSecret, null);
    assert.equal(row.inviteToken, "hashed-token");
  } finally {
    h.restore();
  }
});

test("create inserts a new row when no account with that email exists", async () => {
  const rows: Row[] = [];
  const h = harness(rows);
  try {
    await UserRepository.create(ORG, { email: "new@example.com", name: "New", role: "TEACHER", passwordHash: "h", isActive: true });
    assert.equal(h.calls.create, 1);
    assert.equal(h.calls.update, 0);
    assert.equal(rows[0]!.email, "new@example.com");
  } finally {
    h.restore();
  }
});
