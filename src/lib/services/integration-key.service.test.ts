import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { AuditService } from "./audit.service";
import {
  IntegrationKeyService,
  createIntegrationKeySchema,
  expiryFor,
  hashIntegrationKey,
  keyStatus,
  KEY_VALIDITY_OPTIONS,
} from "./integration-key.service";
import type { RequestContext } from "@/types";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000bb";
const DAY = 24 * 60 * 60 * 1000;

const ctx = {
  orgId: ORG,
  user: { id: "u1", orgId: ORG, role: "ADMIN" },
  requestId: "req-1",
  ipAddress: "127.0.0.1",
  userAgent: "test",
} as unknown as RequestContext;

type Row = {
  id: string;
  orgId: string;
  provider: string;
  name: string;
  keyHash: string;
  keyPreview: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};

function harness() {
  const rows: Row[] = [];
  const audits: any[] = [];
  const model = prisma.integrationKey as any;
  const orig = {
    create: model.create,
    findMany: model.findMany,
    findFirst: model.findFirst,
    findUnique: model.findUnique,
    update: model.update,
    count: model.count,
    audit: AuditService.write,
  };
  model.create = async (a: any) => {
    const row: Row = { id: `k${rows.length + 1}`, revokedAt: null, lastUsedAt: null, createdAt: new Date(), ...a.data };
    rows.push(row);
    return { ...row };
  };
  model.findMany = async (a: any) => rows.filter((r) => r.orgId === a.where.orgId && r.provider === a.where.provider);
  model.findFirst = async (a: any) =>
    rows.find((r) => r.id === a.where.id && r.orgId === a.where.orgId && r.provider === a.where.provider) ?? null;
  model.findUnique = async (a: any) => rows.find((r) => r.keyHash === a.where.keyHash) ?? null;
  model.update = async (a: any) => {
    const row = rows.find((r) => r.id === a.where.id)!;
    Object.assign(row, a.data);
    return { ...row };
  };
  model.count = async (a: any) =>
    rows.filter(
      (r) =>
        r.orgId === a.where.orgId &&
        r.provider === a.where.provider &&
        r.revokedAt === null &&
        (r.expiresAt === null || r.expiresAt.getTime() > Date.now()),
    ).length;
  (AuditService as any).write = async (e: any) => { audits.push(e); };
  return {
    rows,
    audits,
    restore() {
      Object.assign(model, {
        create: orig.create,
        findMany: orig.findMany,
        findFirst: orig.findFirst,
        findUnique: orig.findUnique,
        update: orig.update,
        count: orig.count,
      });
      (AuditService as any).write = orig.audit;
    },
  };
}

test("validity options are exactly 1-3-7-15-30-45-60-never", () => {
  assert.deepEqual([...KEY_VALIDITY_OPTIONS], ["1", "3", "7", "15", "30", "45", "60", "never"]);
  assert.equal(createIntegrationKeySchema.safeParse({ name: "Form A", validity: "2" }).success, false);
  assert.equal(createIntegrationKeySchema.safeParse({ name: "  ", validity: "7" }).success, false);
  assert.equal(createIntegrationKeySchema.safeParse({ name: "Form A", validity: "never" }).success, true);
});

test("expiry is computed per validity; never means no expiry", () => {
  const now = new Date("2026-10-02T00:00:00.000Z");
  for (const days of [1, 3, 7, 15, 30, 45, 60]) {
    const exp = expiryFor(String(days) as (typeof KEY_VALIDITY_OPTIONS)[number], now)!;
    assert.equal(exp.getTime() - now.getTime(), days * DAY);
  }
  assert.equal(expiryFor("never", now), null);
});

test("multiple keys can be created; only the hash is stored and the raw key is returned once", async () => {
  const h = harness();
  try {
    const a = await IntegrationKeyService.create(ctx, "GOOGLE_ADS", { name: "CPL form", validity: "7" });
    const b = await IntegrationKeyService.create(ctx, "GOOGLE_ADS", { name: "Cabin crew form", validity: "never" });

    assert.equal(h.rows.length, 2);
    assert.notEqual(a.key, b.key);
    assert.equal(h.rows[0]!.keyHash, hashIntegrationKey(a.key));
    assert.equal(JSON.stringify(h.rows).includes(a.key), false, "raw key must never be persisted");
    assert.ok(h.rows[0]!.expiresAt);
    assert.equal(h.rows[1]!.expiresAt, null);
    assert.equal(h.audits.length, 2);
    assert.equal(h.audits[0].action, "integration_key.created");
    assert.equal(JSON.stringify(h.audits).includes(a.key), false, "raw key must not be audited");

    const listed = await IntegrationKeyService.list(ctx, "GOOGLE_ADS");
    assert.equal(listed.length, 2);
    assert.ok(listed.every((k) => k.status === "active" && !("key" in k)));
  } finally {
    h.restore();
  }
});

test("verify accepts each active key and rejects unknown, expired, revoked and cross-org keys", async () => {
  const h = harness();
  try {
    const a = await IntegrationKeyService.create(ctx, "GOOGLE_ADS", { name: "A", validity: "30" });
    const b = await IntegrationKeyService.create(ctx, "GOOGLE_ADS", { name: "B", validity: "1" });

    assert.equal(await IntegrationKeyService.verify(ORG, "GOOGLE_ADS", a.key), true);
    assert.equal(await IntegrationKeyService.verify(ORG, "GOOGLE_ADS", b.key), true);
    assert.ok(h.rows[0]!.lastUsedAt, "lastUsedAt is recorded on use");
    assert.equal(await IntegrationKeyService.verify(ORG, "GOOGLE_ADS", "not-a-key"), false);
    assert.equal(await IntegrationKeyService.verify(ORG, "GOOGLE_ADS", ""), false);
    assert.equal(await IntegrationKeyService.verify(OTHER_ORG, "GOOGLE_ADS", a.key), false);

    h.rows[1]!.expiresAt = new Date(Date.now() - 1000);
    assert.equal(await IntegrationKeyService.verify(ORG, "GOOGLE_ADS", b.key), false, "expired key rejected");

    await IntegrationKeyService.revoke(ctx, "GOOGLE_ADS", h.rows[0]!.id);
    assert.equal(await IntegrationKeyService.verify(ORG, "GOOGLE_ADS", a.key), false, "revoked key rejected");
    assert.equal(h.audits.at(-1).action, "integration_key.revoked");
    assert.equal(await IntegrationKeyService.hasActiveKey(ORG, "GOOGLE_ADS"), false);

    const statuses = (await IntegrationKeyService.list(ctx, "GOOGLE_ADS")).map((k) => k.status);
    assert.deepEqual(statuses.sort(), ["expired", "revoked"]);
  } finally {
    h.restore();
  }
});

test("revoking a key from another org is not found", async () => {
  const h = harness();
  try {
    await IntegrationKeyService.create({ ...ctx, orgId: OTHER_ORG } as RequestContext, "GOOGLE_ADS", { name: "X", validity: "7" });
    await assert.rejects(IntegrationKeyService.revoke(ctx, "GOOGLE_ADS", h.rows[0]!.id));
    assert.equal(h.rows[0]!.revokedAt, null);
  } finally {
    h.restore();
  }
});

test("keyStatus precedence: revoked over expired over active", () => {
  const past = new Date(Date.now() - DAY);
  const future = new Date(Date.now() + DAY);
  assert.equal(keyStatus({ expiresAt: future, revokedAt: null }), "active");
  assert.equal(keyStatus({ expiresAt: null, revokedAt: null }), "active");
  assert.equal(keyStatus({ expiresAt: past, revokedAt: null }), "expired");
  assert.equal(keyStatus({ expiresAt: past, revokedAt: new Date() }), "revoked");
});
