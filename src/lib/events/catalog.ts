import type { WorkflowTrigger } from "@prisma/client";

// ─── Canonical event namespace (Interconnect OS) ─────────────────────────────
//
// Standardized dot-notation event names. Existing slash-style Inngest events
// are NEVER renamed — this module only normalizes them for workflow trigger
// matching. New emitters (WhatsApp, intake sources) publish canonical names
// directly; legacy emitters keep working through ALIASES.

export const CANONICAL_EVENTS = {
  // Lead lifecycle
  LEAD_CREATED: "lead.created",
  LEAD_UPDATED: "lead.updated",
  LEAD_STATUS_CHANGED: "lead.status_changed",
  LEAD_ASSIGNED: "lead.assigned",
  SALES_ASSIGNED: "sales.assigned",
  // Intake sources
  EBOOK_DOWNLOADED: "ebook.downloaded",
  CHATBOT_ESCALATED: "chatbot.escalated",
  AI_CALL_COMPLETED: "ai_call.completed",
  CAMPUS_VISIT_BOOKED: "campus_visit.booked",
  // Application / admission
  APPLICATION_CREATED: "application.created",
  APPLICATION_APPROVED: "application.approved",
  APPLICATION_STAGE_CHANGED: "application.stage_changed",
  COURSE_ENROLLED: "course.enrolled",
  // Payments
  PAYMENT_PENDING: "payment.pending",
  PAYMENT_SUCCESS: "payment.success",
  PAYMENT_FAILED: "payment.failed",
  PAYMENT_REFUNDED: "payment.refunded",
  // WhatsApp lifecycle
  WHATSAPP_SENT: "whatsapp.sent",
  WHATSAPP_DELIVERED: "whatsapp.delivered",
  WHATSAPP_READ: "whatsapp.read",
  WHATSAPP_FAILED: "whatsapp.failed",
  WHATSAPP_REPLIED: "whatsapp.replied",
  WHATSAPP_OPTED_OUT: "whatsapp.opted_out",
  // CRM pipeline / deal lifecycle (Section 3)
  DEAL_CREATED: "deal.created",
  DEAL_STAGE_CHANGED: "deal.stage_changed",
  DEAL_ASSIGNED: "deal.assigned",
  DEAL_CONVERTED_TO_ADMISSION: "deal.converted_to_admission",
  DEAL_REVERTED_TO_PROSPECT: "deal.reverted_to_prospect",
} as const;

export type CanonicalEvent = (typeof CANONICAL_EVENTS)[keyof typeof CANONICAL_EVENTS];

// Legacy Inngest event name → canonical name. Extend as new legacy emitters
// appear; never remove an entry (existing workflows depend on matching).
const ALIASES: Record<string, CanonicalEvent> = {
  "lead/created": CANONICAL_EVENTS.LEAD_CREATED,
  "lead/status.changed": CANONICAL_EVENTS.LEAD_STATUS_CHANGED,
  "lead/assigned": CANONICAL_EVENTS.LEAD_ASSIGNED,
  "admission/created": CANONICAL_EVENTS.APPLICATION_CREATED,
  "admission/stage.changed": CANONICAL_EVENTS.APPLICATION_STAGE_CHANGED,
  "payment/received": CANONICAL_EVENTS.PAYMENT_SUCCESS,
  "deal/created": CANONICAL_EVENTS.DEAL_CREATED,
  "deal/stage.changed": CANONICAL_EVENTS.DEAL_STAGE_CHANGED,
  "deal/assigned": CANONICAL_EVENTS.DEAL_ASSIGNED,
  "deal/converted_to_admission": CANONICAL_EVENTS.DEAL_CONVERTED_TO_ADMISSION,
  "deal/reverted_to_prospect": CANONICAL_EVENTS.DEAL_REVERTED_TO_PROSPECT,
};

/**
 * Normalize any emitted Inngest event name to its canonical dot-notation form.
 * Returns null for events that are not part of the automation surface
 * (CMS/media/document events etc.) so the workflow engine can skip them fast.
 */
export function normalizeEventName(raw: string): CanonicalEvent | null {
  const aliased = ALIASES[raw];
  if (aliased) return aliased;
  if (!raw.includes("/") && raw.includes(".")) return raw as CanonicalEvent;
  return null;
}

// Canonical event → WorkflowTrigger enum value used by Workflow.triggerEvent.
export const EVENT_TRIGGER_MAP: Partial<Record<CanonicalEvent, WorkflowTrigger>> = {
  [CANONICAL_EVENTS.LEAD_CREATED]: "LEAD_CREATED",
  [CANONICAL_EVENTS.LEAD_UPDATED]: "LEAD_UPDATED",
  [CANONICAL_EVENTS.LEAD_STATUS_CHANGED]: "LEAD_STATUS_CHANGED",
  [CANONICAL_EVENTS.LEAD_ASSIGNED]: "LEAD_ASSIGNED",
  [CANONICAL_EVENTS.SALES_ASSIGNED]: "LEAD_ASSIGNED",
  [CANONICAL_EVENTS.EBOOK_DOWNLOADED]: "EBOOK_DOWNLOADED",
  [CANONICAL_EVENTS.CHATBOT_ESCALATED]: "CHATBOT_ESCALATED",
  [CANONICAL_EVENTS.AI_CALL_COMPLETED]: "AI_CALL_COMPLETED",
  [CANONICAL_EVENTS.CAMPUS_VISIT_BOOKED]: "CAMPUS_VISIT_BOOKED",
  [CANONICAL_EVENTS.APPLICATION_CREATED]: "APPLICATION_CREATED",
  [CANONICAL_EVENTS.APPLICATION_APPROVED]: "APPLICATION_APPROVED",
  [CANONICAL_EVENTS.APPLICATION_STAGE_CHANGED]: "ADMISSION_STAGE_CHANGED",
  [CANONICAL_EVENTS.COURSE_ENROLLED]: "COURSE_ENROLLED",
  [CANONICAL_EVENTS.PAYMENT_PENDING]: "PAYMENT_PENDING",
  [CANONICAL_EVENTS.PAYMENT_SUCCESS]: "PAYMENT_RECEIVED",
  [CANONICAL_EVENTS.PAYMENT_FAILED]: "PAYMENT_FAILED",
  [CANONICAL_EVENTS.PAYMENT_REFUNDED]: "PAYMENT_REFUNDED",
  [CANONICAL_EVENTS.WHATSAPP_REPLIED]: "WHATSAPP_REPLIED",
  [CANONICAL_EVENTS.WHATSAPP_OPTED_OUT]: "WHATSAPP_OPTED_OUT",
  [CANONICAL_EVENTS.DEAL_CREATED]: "DEAL_CREATED",
  [CANONICAL_EVENTS.DEAL_STAGE_CHANGED]: "DEAL_STAGE_CHANGED",
};

// Raw Inngest event names the workflow engine function subscribes to.
// This is the union of (a) legacy names already emitted by services and
// (b) canonical names future emitters publish directly. One line to extend.
export const TRIGGERABLE_INNGEST_EVENTS: string[] = [
  // legacy emitters (existing services)
  "lead/created",
  "lead/status.changed",
  "lead/assigned",
  "admission/created",
  "admission/stage.changed",
  "payment/received",
  // legacy deal emitters (Section 3 DealService)
  "deal/created",
  "deal/stage.changed",
  "deal/assigned",
  "deal/converted_to_admission",
  "deal/reverted_to_prospect",
  // canonical emitters (Interconnect OS modules)
  CANONICAL_EVENTS.LEAD_UPDATED,
  CANONICAL_EVENTS.APPLICATION_APPROVED,
  CANONICAL_EVENTS.COURSE_ENROLLED,
  CANONICAL_EVENTS.PAYMENT_PENDING,
  CANONICAL_EVENTS.PAYMENT_FAILED,
  CANONICAL_EVENTS.PAYMENT_REFUNDED,
  CANONICAL_EVENTS.WHATSAPP_REPLIED,
  CANONICAL_EVENTS.WHATSAPP_OPTED_OUT,
  CANONICAL_EVENTS.EBOOK_DOWNLOADED,
  CANONICAL_EVENTS.CHATBOT_ESCALATED,
  CANONICAL_EVENTS.AI_CALL_COMPLETED,
  CANONICAL_EVENTS.CAMPUS_VISIT_BOOKED,
  // deal lifecycle (Section 3)
  CANONICAL_EVENTS.DEAL_CREATED,
  CANONICAL_EVENTS.DEAL_STAGE_CHANGED,
  CANONICAL_EVENTS.DEAL_ASSIGNED,
  CANONICAL_EVENTS.DEAL_CONVERTED_TO_ADMISSION,
  CANONICAL_EVENTS.DEAL_REVERTED_TO_PROSPECT,
];

// Internal control-plane event used to execute a specific WorkflowRun
// (created by the matcher, manual run-now, START_WORKFLOW steps, resume).
export const WORKFLOW_RUN_EVENT = "workflow/run.requested";
