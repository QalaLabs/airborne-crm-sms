import { z } from "zod";
import { AdmissionStage, LeadSource, WorkflowTrigger } from "@prisma/client";

export const createDealInputSchema = z.object({
  leadId: z.string().uuid(),
  title: z.string().min(2).max(255),
  stage: z.nativeEnum(AdmissionStage).default("ENQUIRY"),
  value: z.number().nonnegative().optional(),
  currency: z.string().length(3).toUpperCase().default("INR"),
  courseId: z.string().uuid().optional().nullable(),
  batchId: z.string().uuid().optional().nullable(),
  feePlanId: z.string().uuid().optional().nullable(),
  expectedCloseAt: z.string().datetime().optional(),
  source: z.nativeEnum(LeadSource).optional(),
  assignedTo: z.string().uuid().optional(),
  notes: z.string().max(5000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateDealSchema = z.object({
  title: z.string().min(2).max(255).optional(),
  stage: z.nativeEnum(AdmissionStage).optional(),
  value: z.number().nonnegative().optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  courseId: z.string().uuid().optional().nullable(),
  batchId: z.string().uuid().optional().nullable(),
  feePlanId: z.string().uuid().optional().nullable(),
  expectedCloseAt: z.string().datetime().nullable().optional(),
  source: z.nativeEnum(LeadSource).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  notes: z.string().max(5000).optional(),
  lostReason: z.string().max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Stage transitions for a Deal mirror the Admission funnel (documented
 * inference — the product's sales funnel IS the admission funnel; see
 * SECTION_3_RESULT decisions). WON ⇔ ENROLLED, LOST ⇔ DROPPED/CANCELLED.
 */
export const DEAL_STAGE_TRANSITIONS: Record<AdmissionStage, AdmissionStage[]> = {
  ENQUIRY: ["DOCUMENT_COLLECTION", "VERIFICATION", "OFFER_LETTER", "FEE_PAYMENT", "ENROLLED", "DROPPED", "CANCELLED"],
  DOCUMENT_COLLECTION: ["ENQUIRY", "VERIFICATION", "OFFER_LETTER", "FEE_PAYMENT", "ENROLLED", "DROPPED", "CANCELLED"],
  VERIFICATION: ["ENQUIRY", "DOCUMENT_COLLECTION", "OFFER_LETTER", "FEE_PAYMENT", "ENROLLED", "DROPPED", "CANCELLED"],
  OFFER_LETTER: ["ENQUIRY", "DOCUMENT_COLLECTION", "VERIFICATION", "FEE_PAYMENT", "ENROLLED", "DROPPED", "CANCELLED"],
  FEE_PAYMENT: ["ENQUIRY", "DOCUMENT_COLLECTION", "VERIFICATION", "OFFER_LETTER", "ENROLLED", "DROPPED", "CANCELLED"],
  ENROLLED: [],
  DROPPED: ["ENQUIRY", "DOCUMENT_COLLECTION", "VERIFICATION", "OFFER_LETTER", "FEE_PAYMENT"],
  CANCELLED: ["ENQUIRY", "DOCUMENT_COLLECTION", "VERIFICATION", "OFFER_LETTER", "FEE_PAYMENT"],
};

export function canTransitionDealStage(from: AdmissionStage, to: AdmissionStage): boolean {
  if (from === to) return true;
  return DEAL_STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Aliased for the event trigger mapping (keeps deal events in one place). */
export const DEAL_EVENT_TRIGGERS: Record<string, WorkflowTrigger> = {
  created: WorkflowTrigger.DEAL_CREATED,
  stageChanged: WorkflowTrigger.DEAL_STAGE_CHANGED,
};

const dealStageOrStatusStage = z.nativeEnum(AdmissionStage);

export const dealFiltersSchema = z.object({
  stage: dealStageOrStatusStage.optional(),
  isActive: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
  status: z.enum(["open", "won", "lost"]).optional(),
  assignedTo: z.string().uuid().optional(),
  lostReason: z.string().optional(),
  search: z.string().max(255).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sortBy: z
    .enum(["createdAt", "updatedAt", "stage", "value", "expectedCloseAt", "title", "wonAt", "lostAt", "lostReason"])
    .default("updatedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export const convertDealToAdmissionSchema = z.object({
  courseName: z.string().max(255).optional(),
  counselorId: z.string().uuid().optional(),
  campusId: z.string().uuid().optional(),
  feeAmount: z.number().positive().optional(),
  notes: z.string().max(5000).optional(),
});

export const revertDealToProspectSchema = z.object({
  notes: z.string().max(5000).optional(),
});

/** Default persisted loss-reason when a deal closes lost without a reason. */
export const LOSS_REASON_DEFAULT = "Deal closed as lost";

export type CreateDealInput = z.infer<typeof createDealInputSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type DealFilters = z.infer<typeof dealFiltersSchema>;
export type ConvertDealInput = z.infer<typeof convertDealToAdmissionSchema>;
export type RevertDealInput = z.infer<typeof revertDealToProspectSchema>;