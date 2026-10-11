import { z } from "zod";
import { LeadStatus, NotificationEvent, WorkflowTrigger } from "@prisma/client";

// ─── Workflow configuration schemas ──────────────────────────────────────────
// Mirrors src/lib/workflow/types.ts so API payloads are validated before the
// engine ever sees them.

export const waitSpecSchema = z
  .object({
    days: z.number().int().min(0).max(60).optional(),
    hours: z.number().int().min(0).max(24).optional(),
    minutes: z.number().int().min(0).max(59).optional(),
  })
  .refine((v) => (v.days ?? 0) + (v.hours ?? 0) + (v.minutes ?? 0) > 0, {
    message: "WAIT duration must be greater than zero",
  });

interface ConditionSpecShape {
  all?: ConditionSpecShape[];
  any?: ConditionSpecShape[];
  not?: ConditionSpecShape;
  field?: string;
  op?: string;
  value?: unknown;
}

export const conditionSpecSchema: z.ZodType<ConditionSpecShape> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSpecSchema).min(1) }),
    z.object({ any: z.array(conditionSpecSchema).min(1) }),
    z.object({ not: conditionSpecSchema }),
    z.object({
      field: z.string().min(1).max(200),
      op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "notIn", "exists", "notExists"]),
      value: z.unknown().optional(),
    }),
  ]),
);

interface WorkflowStepShape {
  type: string;
  [key: string]: unknown;
}

const stepBase = { name: z.string().max(255).optional() };

export const workflowStepSchema: z.ZodType<WorkflowStepShape> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      ...stepBase,
      type: z.literal("SEND_WHATSAPP"),
      templateName: z.string().max(255).optional(),
      variables: z.record(z.string().max(2000)).optional(),
    }),
    z.object({
      ...stepBase,
      type: z.literal("SEND_EMAIL"),
      event: z.nativeEnum(NotificationEvent),
      variables: z.record(z.string().max(2000)).optional(),
    }),
    z.object({
      ...stepBase,
      type: z.literal("CREATE_TASK"),
      title: z.string().min(1).max(500),
      notes: z.string().max(5000).optional(),
      dueInDays: z.number().int().min(0).max(365).optional(),
      dueInHours: z.number().int().min(0).max(720).optional(),
    }),
    z.object({
      ...stepBase,
      type: z.literal("ASSIGN_LEAD"),
      counselorId: z.string().uuid(),
    }),
    z.object({
      ...stepBase,
      type: z.literal("UPDATE_LEAD"),
      fields: z.object({
        courseInterest: z.string().max(255).optional(),
        city: z.string().max(100).optional(),
        state: z.string().max(100).optional(),
        nextFollowUpInDays: z.number().int().min(0).max(365).optional(),
        customFields: z.record(z.unknown()).optional(),
      }),
    }),
    z.object({
      ...stepBase,
      type: z.literal("UPDATE_STATUS"),
      status: z.nativeEnum(LeadStatus),
    }),
    z.object({ ...stepBase, type: z.literal("ADD_TAG"), tag: z.string().min(1).max(100) }),
    z.object({ ...stepBase, type: z.literal("REMOVE_TAG"), tag: z.string().min(1).max(100) }),
    z.object({ ...stepBase, type: z.literal("WAIT"), duration: waitSpecSchema }),
    z.object({
      ...stepBase,
      type: z.literal("CONDITION"),
      condition: conditionSpecSchema,
      then: z.array(workflowStepSchema).max(50),
      else: z.array(workflowStepSchema).max(50).optional(),
    }),
    z.object({
      ...stepBase,
      type: z.literal("STOP_WORKFLOW"),
      reason: z.string().max(500).optional(),
      stopAllForEntity: z.boolean().optional(),
    }),
    z.object({
      ...stepBase,
      type: z.literal("START_WORKFLOW"),
      workflowCode: z.string().min(1).max(100),
    }),
  ]),
);

export const createWorkflowSchema = z
  .object({
    name: z.string().min(1).max(255),
    code: z
      .string()
      .regex(/^[a-z0-9_-]+$/, "code must be lowercase alphanumeric, dashes or underscores")
      .max(100)
      .optional(),
    description: z.string().max(5000).optional(),
    triggerEvent: z.nativeEnum(WorkflowTrigger),
    triggerConditions: conditionSpecSchema.optional(),
    steps: z.array(workflowStepSchema).max(100).default([]),
    isActive: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    if (val.triggerEvent === "SCHEDULED") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["triggerEvent"],
        message: "SCHEDULED workflows are configured via seed scripts in this phase",
      });
    }
  });

export const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z
    .string()
    .regex(/^[a-z0-9_-]+$/)
    .max(100)
    .nullable()
    .optional(),
  description: z.string().max(5000).nullable().optional(),
  triggerEvent: z.nativeEnum(WorkflowTrigger).optional(),
  triggerConditions: conditionSpecSchema.nullable().optional(),
  steps: z.array(workflowStepSchema).max(100).optional(),
  isActive: z.boolean().optional(),
});

export const runActionSchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
});

export const runNowSchema = z.object({
  entityType: z.enum(["LEAD", "ADMISSION", "PAYMENT", "STUDENT"]),
  entityId: z.string().min(1).max(255),
});

export const workflowFiltersSchema = z.object({
  triggerEvent: z.nativeEnum(WorkflowTrigger).optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const runFiltersSchema = z.object({
  status: z.enum(["RUNNING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED", "STOPPED"]).optional(),
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type WorkflowFilters = z.infer<typeof workflowFiltersSchema>;
export type RunFilters = z.infer<typeof runFiltersSchema>;
