import type { UserRole } from "@prisma/client";
import type { SessionUser } from "@/types";
import { ForbiddenError } from "@/lib/utils/errors";

// ─── Static permission matrix (baseline — overridden by DB rows) ─────────────

type PermissionMatrix = Record<UserRole, Record<string, string[]>>;

export const PERMISSION_MATRIX: PermissionMatrix = {
  SUPER_ADMIN: {
    "*": ["read", "write", "delete", "export", "publish", "assign", "approve", "admin"],
  },
  ADMIN: {
    leads: ["read", "write", "delete", "export", "assign"],
    deals: ["read", "write", "delete", "assign", "export"],
    users: ["read", "write", "delete"],
    students: ["read", "write", "delete", "export"],
    admissions: ["read", "write", "delete"],
    documents: ["read", "write", "delete", "approve"],
    payments: ["read", "write", "delete", "export"],
    courses: ["read", "write", "delete", "publish"],
    resources: ["read", "write", "delete", "publish"],
    jobs: ["read", "write", "delete", "publish"],
    job_applications: ["read", "write", "delete"],
    hiring_partners: ["read", "write", "delete"],
    placements: ["read", "write", "delete"],
    testimonials: ["read", "write", "delete", "approve"],
    settings: ["read", "write"],
    media: ["read", "write", "delete"],
    blocks: ["read", "write", "delete", "publish"],
    pages: ["read", "write", "delete", "publish"],
    nav: ["read", "write", "delete"],
    notifications: ["read", "write"],
    analytics: ["read"],
    audit: ["read"],
    organizations: ["read", "write", "admin"],
    campuses: ["read", "write", "delete"],
    workflows: ["read", "write", "delete"],
    lms: ["read", "write", "delete", "publish"],
    lms_courses: ["read", "write", "delete", "publish"],
    lms_attendance: ["read", "write", "delete"],
    lms_assessments: ["read", "write", "delete"],
    lms_assignments: ["read", "write", "delete"],
    lms_chat: ["read", "write", "delete"],
    lms_progress: ["read", "write"],
    lms_certificates: ["read", "write", "delete"],
    lms_notifications: ["read", "write"],
  },
  MARKETING_MANAGER: {
    leads: ["read", "write", "export", "assign"],
    resources: ["read", "write", "publish"],
    jobs: ["read", "write", "publish"],
    media: ["read", "write"],
    blocks: ["read"],
    pages: ["read"],
    nav: ["read"],
    analytics: ["read"],
    testimonials: ["read", "approve"],
  },
  CONTENT_MANAGER: {
    courses: ["read", "write", "delete", "publish"],
    resources: ["read", "write", "publish"],
    media: ["read", "write", "delete"],
    blocks: ["read", "write", "delete", "publish"],
    pages: ["read", "write", "delete", "publish"],
    nav: ["read", "write"],
    testimonials: ["read", "approve"],
  },
  ADMISSIONS_COUNSELOR: {
    leads: ["read", "write"],
    deals: ["read", "write"],
    students: ["read", "write"],
    admissions: ["read", "write"],
    documents: ["read", "write"],
    payments: ["read"],
    analytics: ["read"],
  },
  PLACEMENT_MANAGER: {
    placements: ["read", "write", "delete"],
    testimonials: ["read", "write", "approve"],
    jobs: ["read", "write", "publish"],
    job_applications: ["read", "write"],
    hiring_partners: ["read", "write"],
    students: ["read"],
    admissions: ["read"],
    courses: ["read"],
    media: ["read", "write"],
    analytics: ["read"],
  },
  SUPPORT_STAFF: {
    leads: ["read"],
    students: ["read"],
    admissions: ["read"],
    documents: ["read"],
  },
  // SMS portal roles — scoped LMS resources only; no CRM/CMS write
  TEACHER: {
    lms: ["read", "write"],
    lms_courses: ["read", "write"],
    lms_attendance: ["read", "write"],
    lms_assessments: ["read", "write"],
    lms_assignments: ["read", "write"],
    lms_chat: ["read", "write"],
    lms_progress: ["read"],
    students: ["read"],
    media: ["read", "write"],
  },
  STUDENT: {
    lms: ["read"],
    // Student self-service actions on their own records (bookmarks, quiz
    // attempts, assignment submissions). Read guard for self-service GETs uses
    // `read, lms`; the three POST mutations use `write, lms_student`.
    lms_student: ["read", "write"],
    lms_courses: ["read"],
    lms_progress: ["read", "write"],
    // No `write` on lms_assessments — students must not set their own score or
    // self-promote to PASS. Quiz-derived assessment sync is server-graded via
    // the quiz submit flow (guarded by `read, lms`); admin/faculty grading uses
    // `write, lms_assessments` and is granted to TEACHER/ADMIN only.
    lms_assessments: ["read"],
    lms_assignments: ["read"],
    lms_chat: ["read", "write"],
    lms_certificates: ["read"],
    lms_notifications: ["read", "write"],
  },
};

// ─── ABAC condition types ────────────────────────────────────────────────────

export interface ABACCondition {
  assigned_to?: "self";
  org_id?: "own";
  campus_id?: "own";
}

// ─── Permission checker ──────────────────────────────────────────────────────

export function hasPermission(
  user: SessionUser,
  action: string,
  resource: string,
): boolean {
  return roleCan(user.role, action, resource);
}

/** UI affordance check only; every API route still enforces guard() server-side. */
export function roleCan(role: string | undefined | null, action: string, resource: string): boolean {
  const matrix = role ? PERMISSION_MATRIX[role as UserRole] : undefined;
  if (!matrix) return false;

  // Super admin wildcard
  if (matrix["*"]?.includes(action)) return true;

  const allowed = matrix[resource];
  if (!allowed) return false;

  return allowed.includes(action);
}

/**
 * Roles that may assign leads but lack users:read (e.g. MARKETING_MANAGER)
 * still need the counselor picker; they get a minimal id/name/role list only.
 */
export function isAssigneeListOnly(user: SessionUser, role: string | undefined): boolean {
  return (
    role === "ADMISSIONS_COUNSELOR" &&
    !hasPermission(user, "read", "users") &&
    hasPermission(user, "assign", "leads")
  );
}

// Check ownership condition (ABAC layer)
export function meetsCondition(
  user: SessionUser,
  condition: ABACCondition | null,
  record: Record<string, unknown>,
): boolean {
  if (!condition) return true;

  if (condition.assigned_to === "self") {
    return record["assignedTo"] === user.id || record["createdBy"] === user.id;
  }

  if (condition.campus_id === "own" && user.campusId) {
    return record["campusId"] === user.campusId;
  }

  return true;
}

export function requirePermission(
  user: SessionUser,
  action: string,
  resource: string,
): void {
  if (!hasPermission(user, action, resource)) {
    throw new ForbiddenError(action, resource);
  }
}
