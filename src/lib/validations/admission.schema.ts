import { z } from "zod";
import { AdmissionStage } from "@prisma/client";

export const createAdmissionSchema = z.object({
  leadId: z.string().uuid(),
  campusId: z.string().uuid().optional(),
  counselorId: z.string().uuid().optional(),
  courseName: z.string().max(255).optional(),
  courseId: z.string().uuid().optional(),
  batchName: z.string().max(255).optional(),
  batchStartDate: z.string().datetime().optional(),
  batchId: z.string().uuid().optional(),
  feePlanId: z.string().uuid().optional(),
  feeAmount: z.number().positive().optional(),
  feeDiscount: z.number().min(0).default(0),
  notes: z.string().max(5000).optional(),
  metadata: z.record(z.unknown()).optional(),
}).superRefine((v, ctx) => {
  if (v.feeAmount !== undefined && v.feeDiscount > v.feeAmount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["feeDiscount"],
      message: "Fee discount cannot exceed the fee amount",
    });
  }
});

export const updateAdmissionSchema = z.object({
  campusId: z.string().uuid().optional(),
  counselorId: z.string().uuid().optional().nullable(),
  studentId: z.string().uuid().optional().nullable(),
  courseName: z.string().max(255).optional(),
  courseId: z.string().uuid().optional().nullable(),
  batchName: z.string().max(255).optional(),
  batchStartDate: z.string().datetime().optional().nullable(),
  batchId: z.string().uuid().optional().nullable(),
  feePlanId: z.string().uuid().optional().nullable(),
  feeAmount: z.number().positive().optional(),
  feeDiscount: z.number().min(0).optional(),
  notes: z.string().max(5000).optional(),
  metadata: z.record(z.unknown()).optional(),
}).superRefine((v, ctx) => {
  if (v.feeAmount !== undefined && v.feeDiscount !== undefined && v.feeDiscount > v.feeAmount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["feeDiscount"],
      message: "Fee discount cannot exceed the fee amount",
    });
  }
});

export const changeStageSchema = z.object({
  toStage: z.nativeEnum(AdmissionStage),
  notes: z.string().max(2000).optional(),
  // When moving to ENROLLED, optionally create/link student
  createStudent: z.boolean().optional(),
  studentId: z.string().uuid().optional(),
});

export const admissionFiltersSchema = z.object({
  stage: z.nativeEnum(AdmissionStage).optional(),
  campusId: z.string().uuid().optional(),
  counselorId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  search: z.string().max(255).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(200).default(20),
  sortBy: z.enum(["createdAt", "stage", "applicationNo", "stageChangedAt"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

// Valid stage transitions — enforced in service
export const STAGE_TRANSITIONS: Record<AdmissionStage, AdmissionStage[]> = {
  ENQUIRY: ["DOCUMENT_COLLECTION", "VERIFICATION", "ENROLLED", "CANCELLED"],
  DOCUMENT_COLLECTION: ["VERIFICATION", "ENQUIRY", "ENROLLED", "CANCELLED"],
  VERIFICATION: ["OFFER_LETTER", "DOCUMENT_COLLECTION", "ENROLLED", "CANCELLED"],
  OFFER_LETTER: ["FEE_PAYMENT", "VERIFICATION", "ENROLLED", "CANCELLED"],
  FEE_PAYMENT: ["ENROLLED", "OFFER_LETTER", "CANCELLED"],
  ENROLLED: ["DROPPED"],
  DROPPED: [],
  CANCELLED: [],
};

export type CreateAdmissionInput = z.infer<typeof createAdmissionSchema>;
export type UpdateAdmissionInput = z.infer<typeof updateAdmissionSchema>;
export type ChangeStageInput = z.infer<typeof changeStageSchema>;
export type AdmissionFilters = z.infer<typeof admissionFiltersSchema>;
