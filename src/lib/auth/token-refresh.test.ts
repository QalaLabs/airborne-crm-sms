import test from "node:test";
import assert from "node:assert/strict";
import type { UserRole } from "@prisma/client";
import { refreshTokenClaims, type CurrentUserRecord } from "./token-refresh";
import { guard } from "@/lib/middleware/permissions";
import { AppError } from "@/lib/utils/errors";
import type { SessionUser } from "@/types";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-000000000001";

function fakeDb(initial: Partial<CurrentUserRecord> & { isActive?: boolean }) {
  const row = {
    id: USER,
    orgId: ORG,
    campusId: null as string | null,
    role: "ADMIN" as UserRole,
    name: "Asha",
    email: "asha@example.test",
    avatarUrl: null as string | null,
    isActive: true,
    ...initial,
  };
  let reads = 0;
  return {
    row,
    get reads() { return reads; },
    load: async (id: string) => {
      reads++;
      if (id !== row.id || !row.isActive) return null;
      const { isActive: _ignored, ...rest } = row;
      return rest;
    },
  };
}

function tokenFor(role: UserRole) {
  return { id: USER, orgId: ORG, campusId: null, role, name: "Asha", email: "asha@example.test", sub: USER };
}

function asSessionUser(token: Record<string, unknown>): SessionUser {
  return { id: token.id, orgId: token.orgId, campusId: token.campusId ?? null, role: token.role, name: token.name, email: token.email, avatarUrl: null } as SessionUser;
}

const isForbidden = (e: unknown) => e instanceof AppError && e.statusCode === 403;

test("demotion applies on the next request of an already-open session", async () => {
  const db = fakeDb({ role: "ADMIN" });
  const openSession = tokenFor("ADMIN");

  const before = await refreshTokenClaims(openSession, db.load);
  assert.equal(before?.role, "ADMIN");
  assert.doesNotThrow(() => guard(asSessionUser(before!), "delete", "users"));

  db.row.role = "SUPPORT_STAFF";
  const after = await refreshTokenClaims(openSession, db.load);
  assert.equal(after?.role, "SUPPORT_STAFF");
  assert.throws(() => guard(asSessionUser(after!), "delete", "users"), isForbidden);
});

test("elevation applies immediately without re-login", async () => {
  const db = fakeDb({ role: "SUPPORT_STAFF" });
  const openSession = tokenFor("SUPPORT_STAFF");
  const before = await refreshTokenClaims(openSession, db.load);
  assert.throws(() => guard(asSessionUser(before!), "delete", "users"), isForbidden);

  db.row.role = "ADMIN";
  const after = await refreshTokenClaims(openSession, db.load);
  assert.equal(after?.role, "ADMIN");
  assert.doesNotThrow(() => guard(asSessionUser(after!), "delete", "users"));
});

test("every open session of the same user sees the new role", async () => {
  const db = fakeDb({ role: "ADMIN" });
  const laptop = tokenFor("ADMIN");
  const phone = { ...tokenFor("ADMIN"), jti: "phone" };
  db.row.role = "CONTENT_MANAGER";
  const [a, b] = await Promise.all([refreshTokenClaims(laptop, db.load), refreshTokenClaims(phone, db.load)]);
  assert.equal(a?.role, "CONTENT_MANAGER");
  assert.equal(b?.role, "CONTENT_MANAGER");
  assert.equal(db.reads, 2, "each session read hits the DB, no cached role");
});

test("deactivated, deleted or unknown user revokes the session", async () => {
  const db = fakeDb({});
  db.row.isActive = false;
  assert.equal(await refreshTokenClaims(tokenFor("ADMIN"), db.load), null);
  assert.equal(await refreshTokenClaims({ ...tokenFor("ADMIN"), id: undefined }, db.load), null);
  assert.equal(await refreshTokenClaims({ ...tokenFor("ADMIN"), id: "someone-else" }, fakeDb({}).load), null);
});

test("campus reassignment flows into the token; stale forged role claim is overwritten", async () => {
  const db = fakeDb({ role: "ADMISSIONS_COUNSELOR", campusId: "campus-2" });
  const forged = { ...tokenFor("SUPER_ADMIN"), campusId: "campus-1" };
  const out = await refreshTokenClaims(forged, db.load);
  assert.equal(out?.role, "ADMISSIONS_COUNSELOR");
  assert.equal(out?.campusId, "campus-2");
});

test("token whose org no longer matches the user row is revoked", async () => {
  const db = fakeDb({ orgId: "00000000-0000-4000-8000-0000000000bb" });
  assert.equal(await refreshTokenClaims(tokenFor("ADMIN"), db.load), null);
});
