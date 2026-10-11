import type { Prisma } from "@prisma/client";

export type AnalyticsUser = { id: string; role: string };

/**
 * M-03: build per-role analytics query scopes. For an ADMISSIONS_COUNSELOR every
 * aggregate (leads, admissions, revenue/payments, activity, student totals) is
 * limited to records belonging to that counselor, so a counselor cannot infer
 * org-wide volume or per-counselor performance. Pure and unit-testable.
 *
 * Role-based and fail-closed: a counselor is ALWAYS counselor-scoped even if a
 * user id is absent, so no code path can degrade to an org-wide read.
 *
 * Kept OUT of the route file because Next.js route modules may only export
 * HTTP handlers (GET/POST/...), not arbitrary functions.
 */
export function buildAnalyticsScope(user: AnalyticsUser, orgId: string): {
  isCounselor: boolean;
  leadWhere: Prisma.LeadWhereInput;
  admissionWhere: Prisma.AdmissionWhereInput;
  paymentWhere: Prisma.PaymentTransactionWhereInput;
  activityWhere: Prisma.LeadActivityWhereInput;
  counselorWhere: Prisma.UserWhereInput;
  studentWhere: Prisma.StudentWhereInput;
  dealWhere: Prisma.DealWhereInput;
} {
  const isCounselor = user.role === "ADMISSIONS_COUNSELOR";

  const leadWhere: Prisma.LeadWhereInput = { orgId, deletedAt: null };
  if (isCounselor) {
    leadWhere.assignedTo = user.id;
  }

  const admissionWhere: Prisma.AdmissionWhereInput = isCounselor
    ? { orgId, lead: { assignedTo: user.id } }
    : { orgId };

  const paymentWhere: Prisma.PaymentTransactionWhereInput = isCounselor
    ? { orgId, status: "COMPLETED", admission: { lead: { assignedTo: user.id } } }
    : { orgId, status: "COMPLETED" };

  const activityWhere: Prisma.LeadActivityWhereInput = isCounselor
    ? { orgId, performedBy: user.id }
    : { orgId };

  const counselorWhere: Prisma.UserWhereInput = {
    orgId,
    role: "ADMISSIONS_COUNSELOR",
    isActive: true,
    deletedAt: null,
    ...(isCounselor ? { id: user.id } : {}),
  };

  const studentWhere: Prisma.StudentWhereInput = {
    orgId,
    deletedAt: null,
    ...(isCounselor ? { lead: { assignedTo: user.id } } : {}),
  };

  const dealWhere: Prisma.DealWhereInput = { orgId, deletedAt: null };
  if (isCounselor) {
    dealWhere.assignedTo = user.id;
  }

  return {
    isCounselor,
    leadWhere,
    admissionWhere,
    paymentWhere,
    activityWhere,
    counselorWhere,
    studentWhere,
    dealWhere,
  };
}