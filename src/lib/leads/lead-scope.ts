import type { SessionUser } from "@/types";

/**
 * Server-side read scope for lead queries. Counselors only ever see leads
 * assigned to them, whatever `assignedTo` the client asked for.
 */
export function applyLeadReadScope<T extends { assignedTo?: string }>(user: SessionUser, filters: T): T {
  if (user.role === "ADMISSIONS_COUNSELOR") {
    return { ...filters, assignedTo: user.id };
  }
  return filters;
}
