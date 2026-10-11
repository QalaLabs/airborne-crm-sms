import { validate as isValidUuid } from "uuid";

/**
 * Returns `value` only when it is a valid UUID, otherwise `undefined`.
 *
 * Inngest event payloads may carry non-UUID actor/request markers emitted by
 * service-level publish paths, e.g. actorId: "system", requestId: "cron-page-…",
 * or the public lead route's requestId (IP address). Those values must never be
 * written into UUID-typed columns (AuditLog.userId, AuditLog.requestId,
 * ActivityFeedItem.actorId). `undefined` maps to NULL in the Prisma writes, so a
 * scheduled/system or public-form action is represented by a null actor rather
 * than a fabricated value.
 */
export function validUuid(value?: string | null): string | undefined {
  return value ? (isValidUuid(value) ? value : undefined) : undefined;
}
