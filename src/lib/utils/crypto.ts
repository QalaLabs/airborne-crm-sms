import { createHash, timingSafeEqual } from "crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Length-safe, constant-time string comparison. `timingSafeEqual` throws when
 * buffers differ in length, so lengths are compared first (a length check does
 * not leak useful timing information here — attacker and secret lengths are
 * both effectively knowable).
 */
export function safeEqualString(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a == null || b == null) return false;
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export function buildAuditRowHash(fields: {
  id: bigint;
  orgId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  occurredAt: Date;
  prevHash?: string | null;
}): string {
  const raw = [
    fields.id.toString(),
    fields.orgId,
    fields.userId ?? "",
    fields.action,
    fields.entityType,
    fields.entityId ?? "",
    fields.occurredAt.toISOString(),
    fields.prevHash ?? "",
  ].join("|");
  return sha256(raw);
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export function generateInviteToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
