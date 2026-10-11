import { z } from "zod";
import { LeadSource, LeadStatus, ActivityType } from "@prisma/client";
import { MEETING_MODES, isMeetingMode } from "@/lib/crm/meeting-mode";
import { INITIAL_LEAD_STATUSES, isInitialLeadStatus } from "@/lib/leads/lead-status";
import { parseISTWallClock } from "@/lib/analytics/date-range";

export const createLeadSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(7).max(20),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  pincode: z.string().max(10).optional(),
  googleId: z.string().max(255).optional(),
  manualAmount: z.number().nonnegative().optional(),
  courseInterest: z.string().max(255).optional(),
  source: z.nativeEnum(LeadSource).default("DIRECT"),
  assignedTo: z.string().uuid().optional(),
  campusId: z.string().uuid().optional(),
  utmSource: z.string().max(255).optional(),
  utmMedium: z.string().max(255).optional(),
  utmCampaign: z.string().max(255).optional(),
  utmTerm: z.string().max(255).optional(),
  utmContent: z.string().max(255).optional(),
  referrerUrl: z.string().url().optional().or(z.literal("")),
  landingPage: z.string().max(1000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  customFields: z.record(z.unknown()).optional(),
  nextFollowUp: z.string().datetime().optional(),
  notes: z.string().max(5000).optional(),
  status: z
    .nativeEnum(LeadStatus)
    .refine(isInitialLeadStatus, {
      message: `Initial status must be one of: ${INITIAL_LEAD_STATUSES.join(", ")}`,
    })
    .optional(),
});

/** Course / batch / fee decided when a lead becomes a Prospect (stored on the deal). */
export const dealDataSchema = z.object({
  courseId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  feePlanId: z.string().uuid().optional(),
  value: z.number().positive().optional(),
});

export const updateLeadSchema = createLeadSchema.omit({ status: true }).partial().extend({
  status: z.nativeEnum(LeadStatus).optional(),
  lostReason: z.string().max(1000).optional(),
  dealData: dealDataSchema.optional(),
});

export const updateLeadStatusSchema = z.object({
  status: z.nativeEnum(LeadStatus),
  lostReason: z.string().max(1000).optional(),
});

export const assignLeadSchema = z.object({
  counselorId: z.string().uuid(),
});

export const bulkAssignLeadsSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(500),
  counselorId: z.string().uuid(),
  note: z.string().max(1000).optional(),
});

/** Server-side priority derived from lead score (Phase 2 page mapping). */
export const LEAD_PRIORITY_SCORE = {
  HIGH: 80,
  MEDIUM: 50,
  LOW: 0,
} as const;

export type LeadPriority = keyof typeof LEAD_PRIORITY_SCORE; // "HIGH" | "MEDIUM" | "LOW"

/**
 * Lead list date bound on `createdAt`. `YYYY-MM-DD` is an IST calendar day
 * (start of day for `dateFrom`, end of day for `dateTo`); full ISO datetimes
 * pass through unchanged for API callers.
 */
function leadDateBound(edge: "start" | "end") {
  return z
    .string()
    .trim()
    .transform((value, ctx) => {
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? parseISTWallClock(value, edge)
        : z.string().datetime({ offset: true }).safeParse(value).success
          ? new Date(value)
          : null;
      if (!parsed || Number.isNaN(parsed.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use YYYY-MM-DD (IST) or an ISO datetime" });
        return z.NEVER;
      }
      return parsed.toISOString();
    });
}

const leadFiltersObject = z.object({
  status: z.nativeEnum(LeadStatus).optional(),
  source: z.nativeEnum(LeadSource).optional(),
  assignedTo: z.string().uuid().optional(),
  campusId: z.string().uuid().optional(),
  courseInterest: z.string().optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  lostReason: z.string().optional(),
  search: z.string().max(255).optional(),
  dateFrom: leadDateBound("start").optional(),
  dateTo: leadDateBound("end").optional(),
  isActive: z.preprocess((v) => v === "true", z.boolean()).optional(),
  followUpOverdue: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sortBy: z
    .enum([
      "createdAt",
      "updatedAt",
      "score",
      "name",
      "status",
      "nextFollowUp",
      "lostReason",
      "phone",
      "source",
      "courseInterest",
      "manualAmount",
    ])
    .default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export const leadFiltersSchema = leadFiltersObject.refine(
  (f) => !f.dateFrom || !f.dateTo || new Date(f.dateFrom).getTime() <= new Date(f.dateTo).getTime(),
  { message: "Start date must be on or before the end date", path: ["dateFrom"] },
);

// Lead Activity schemas
export const createActivitySchema = z.object({
  activityType: z.nativeEnum(ActivityType),
  title: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  outcome: z.string().max(255).optional(),
  nextAction: z.string().max(1000).optional(),
  dueAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  durationMins: z.number().min(0).max(1440).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateFollowUpSchema = z.object({
  nextFollowUp: z.string().datetime().nullable(),
});

const meetingModeSchema = z.enum(MEETING_MODES, {
  errorMap: () => ({ message: "Meeting mode must be Online, Offline or Campus Visit" }),
});

// metadata.mode may only carry a supported mode, so it cannot bypass `mode` validation.
const meetingMetadataSchema = z
  .record(z.unknown())
  .refine((m) => m.mode === undefined || isMeetingMode(m.mode), {
    message: "Meeting mode must be Online, Offline or Campus Visit",
    path: ["mode"],
  });

export const scheduleMeetingSchema = z.object({
  leadId: z.string().uuid(),
  title: z.string().max(500).optional(),
  dueAt: z.string().datetime(),
  durationMins: z.number().int().min(0).max(1440).optional(),
  mode: meetingModeSchema.optional(),
  notes: z.string().max(5000).optional(),
  outcome: z.string().max(255).optional(),
  metadata: meetingMetadataSchema.optional(),
});

export const updateMeetingSchema = z.object({
  title: z.string().max(500).optional(),
  dueAt: z.string().datetime().optional(),
  durationMins: z.number().int().min(0).max(1440).optional(),
  mode: meetingModeSchema.optional(),
  notes: z.string().max(5000).optional(),
  outcome: z.string().max(255).optional(),
  metadata: meetingMetadataSchema.optional(),
});

// Meeting completion / cancellation action for the dedicated route.
export const meetingActionSchema = z.object({
  action: z.enum(["complete", "cancel"]),
  outcome: z.string().max(255).optional(),
});

export const completeActivitySchema = z.object({
  completedAt: z.string().datetime().optional(),
  outcome: z.string().max(255).optional(),
});

export const convertLeadSchema = z.object({
  courseName: z.string().max(255).optional(),
  counselorId: z.string().uuid().optional(),
  campusId: z.string().uuid().optional(),
  feeAmount: z.number().positive().optional(),
  notes: z.string().max(5000).optional(),
  dealData: dealDataSchema.optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type LeadFilters = z.infer<typeof leadFiltersSchema>;
export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type CompleteActivityInput = z.infer<typeof completeActivitySchema>;
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;
export type ScheduleMeetingInput = z.infer<typeof scheduleMeetingSchema>;
