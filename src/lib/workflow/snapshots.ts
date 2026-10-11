import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";

// ─── Entity snapshots ─────────────────────────────────────────────────────────
//
// The engine resolves the entity referenced by a run/event into a plain object
// used for condition evaluation and action variable interpolation. Snapshots
// are read fresh at execution time (never trusted from event payloads).

export const ENTITY_TYPES = {
  LEAD: "lead",
  ADMISSION: "admission",
  PAYMENT: "payment",
  STUDENT: "student",
} as const;

export type EntityType = (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES];

const leadSelect = {
  id: true,
  orgId: true,
  campusId: true,
  name: true,
  email: true,
  phone: true,
  city: true,
  state: true,
  courseInterest: true,
  source: true,
  status: true,
  score: true,
  tags: true,
  whatsappOptOut: true,
  assignedTo: true,
  nextFollowUp: true,
  convertedAt: true,
  customFields: true,
  createdAt: true,
} satisfies Prisma.LeadSelect;

const admissionSelect = {
  id: true,
  orgId: true,
  campusId: true,
  studentId: true,
  leadId: true,
  applicationNo: true,
  stage: true,
  courseName: true,
  batchName: true,
  feeAmount: true,
  feeDiscount: true,
  feeFinal: true,
  feePaid: true,
  feeBalance: true,
  counselorId: true,
  createdAt: true,
  lead: { select: { id: true, name: true, email: true, phone: true, status: true, assignedTo: true } },
} satisfies Prisma.AdmissionSelect;

const paymentSelect = {
  id: true,
  orgId: true,
  campusId: true,
  admissionId: true,
  studentId: true,
  amount: true,
  currency: true,
  method: true,
  status: true,
  receiptNo: true,
  feeType: true,
  paidAt: true,
  gateway: true,
  createdAt: true,
  admission: {
    select: {
      id: true,
      applicationNo: true,
      stage: true,
      leadId: true,
      lead: { select: { id: true, name: true, email: true, phone: true, assignedTo: true } },
    },
  },
} satisfies Prisma.PaymentTransactionSelect;

const studentSelect = {
  id: true,
  orgId: true,
  campusId: true,
  leadId: true,
  userId: true,
  studentCode: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  status: true,
  enrolledAt: true,
  createdAt: true,
} satisfies Prisma.StudentSelect;

/**
 * Load the current snapshot for an entity. Returns null when the entity does
 * not exist in the org — callers treat that as "skip, don't retry".
 */
export async function loadEntitySnapshot(
  orgId: string,
  entityType: string,
  entityId: string,
): Promise<Record<string, unknown> | null> {
  switch (entityType) {
    case ENTITY_TYPES.LEAD: {
      const lead = await prisma.lead.findFirst({ where: { id: entityId, orgId }, select: leadSelect });
      return lead ? (lead as unknown as Record<string, unknown>) : null;
    }
    case ENTITY_TYPES.ADMISSION: {
      const admission = await prisma.admission.findFirst({
        where: { id: entityId, orgId },
        select: admissionSelect,
      });
      if (!admission) return null;
      // Flatten the linked lead to the top level so conditions like
      // "lead.status eq NEW" and actions that need leadId/phone just work.
      const { lead, ...rest } = admission;
      return {
        ...rest,
        leadId: lead?.id ?? rest.leadId,
        leadName: lead?.name,
        email: lead?.email,
        phone: lead?.phone,
        leadStatus: lead?.status,
        assignedTo: lead?.assignedTo,
      } as Record<string, unknown>;
    }
    case ENTITY_TYPES.PAYMENT: {
      const payment = await prisma.paymentTransaction.findFirst({
        where: { id: entityId, orgId },
        select: paymentSelect,
      });
      if (!payment) return null;
      const { admission, ...rest } = payment;
      return {
        ...rest,
        applicationNo: admission?.applicationNo,
        admissionStage: admission?.stage,
        leadId: admission?.leadId,
        leadName: admission?.lead?.name,
        email: admission?.lead?.email,
        phone: admission?.lead?.phone,
        assignedTo: admission?.lead?.assignedTo,
      } as Record<string, unknown>;
    }
    case ENTITY_TYPES.STUDENT: {
      const student = await prisma.student.findFirst({ where: { id: entityId, orgId }, select: studentSelect });
      return student ? (student as unknown as Record<string, unknown>) : null;
    }
    default:
      return null;
  }
}

/** Best-effort entity resolution from an Inngest event payload. */
export function resolveEntityFromEvent(
  eventName: string,
  data: Record<string, unknown>,
): { entityType: EntityType; entityId: string } | null {
  const canonicalMap: Array<[RegExp, EntityType, string]> = [
    [/^lead\./, ENTITY_TYPES.LEAD, "leadId"],
    [/^(application|admission)\./, ENTITY_TYPES.ADMISSION, "admissionId"],
    [/^payment\./, ENTITY_TYPES.PAYMENT, "paymentId"],
    [/^course\.enrolled$/, ENTITY_TYPES.STUDENT, "studentId"],
    // WhatsApp lifecycle events ride on the linked lead. Inbound messages from
    // numbers with no lead on file carry no leadId — the matcher skips them
    // (the message is still recorded in the inbox for manual follow-up).
    [/^whatsapp\./, ENTITY_TYPES.LEAD, "leadId"],
  ];
  for (const [pattern, entityType, idField] of canonicalMap) {
    if (pattern.test(eventName)) {
      const entityId = data[idField];
      if (typeof entityId === "string" && entityId) return { entityType, entityId };
      return null;
    }
  }
  return null;
}
