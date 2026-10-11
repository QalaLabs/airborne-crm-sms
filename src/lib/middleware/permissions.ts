import type { SessionUser } from "@/types";
import { hasPermission, meetsCondition, type ABACCondition } from "@/lib/utils/permissions";
import { ForbiddenError } from "@/lib/utils/errors";

// Route handler guard — throws ForbiddenError if check fails
export function guard(
  user: SessionUser,
  action: string,
  resource: string,
): void {
  if (!hasPermission(user, action, resource)) {
    throw new ForbiddenError(action, resource);
  }
}

// Guard with ABAC record check — call after fetching the record
export function guardRecord(
  user: SessionUser,
  action: string,
  resource: string,
  record: Record<string, unknown>,
  condition: ABACCondition | null,
): void {
  guard(user, action, resource);
  if (!meetsCondition(user, condition, record)) {
    throw new ForbiddenError(action, resource);
  }
}

// Get ABAC condition for counselor role (own records only)
export function getCounselorCondition(user: SessionUser): ABACCondition | null {
  if (user.role === "ADMISSIONS_COUNSELOR") {
    return { assigned_to: "self" };
  }
  return null;
}
