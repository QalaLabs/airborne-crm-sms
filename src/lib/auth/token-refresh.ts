import type { UserRole } from "@prisma/client";

export interface AuthTokenClaims {
  id?: unknown;
  orgId?: unknown;
  campusId?: unknown;
  role?: unknown;
  name?: string | null;
  email?: string | null;
  avatarUrl?: unknown;
  [key: string]: unknown;
}

export interface CurrentUserRecord {
  id: string;
  orgId: string;
  campusId: string | null;
  role: UserRole;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export type CurrentUserLoader = (userId: string) => Promise<CurrentUserRecord | null>;

/**
 * Re-derive authorization claims from the database on every session read.
 * The JWT only identifies the user; role, campus and org always come from the
 * current user row, so a role change or deactivation takes effect on the very
 * next request in every open session. Returns null to revoke the session.
 */
export async function refreshTokenClaims<T extends AuthTokenClaims>(
  token: T,
  loadUser: CurrentUserLoader,
): Promise<T | null> {
  if (typeof token.id !== "string" || token.id === "") return null;
  const current = await loadUser(token.id);
  if (!current) return null;
  if (typeof token.orgId === "string" && token.orgId !== current.orgId) return null;

  return {
    ...token,
    orgId: current.orgId,
    campusId: current.campusId,
    role: current.role,
    name: current.name,
    email: current.email,
    avatarUrl: current.avatarUrl,
  };
}
