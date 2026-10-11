import { z } from "zod";

export const feePlanItemSchema = z
  .object({
    name: z.string().min(1).max(255),
    // Exactly one of amount (fixed rupee) or percentOfFee (% of course fee).
    amount: z.number().positive().max(9_999_999.99).optional(),
    percentOfFee: z.number().positive().max(100).optional(),
    dueOffsetDays: z.number().int().min(0).default(0),
    sortOrder: z.number().int().min(0).default(0),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine((item) => (item.amount !== undefined) !== (item.percentOfFee !== undefined), {
    message: "Each item must specify exactly one of a fixed amount or a percent of the course fee",
  });

const PERCENT_SUM_TOLERANCE = 0.01;

/**
 * Percentage instalments split one course fee, and the admission's final fee is
 * the plan total — so when a plan uses percentages they must cover exactly 100%
 * (fixed-amount items such as a registration fee may sit alongside them).
 */
export function percentSumError(items: Array<{ percentOfFee?: number | null }>): string | null {
  const percentItems = items.filter((i) => i.percentOfFee !== undefined && i.percentOfFee !== null);
  if (percentItems.length === 0) return null;
  const sum = percentItems.reduce((acc, i) => acc + Number(i.percentOfFee), 0);
  if (Math.abs(sum - 100) <= PERCENT_SUM_TOLERANCE) return null;
  return `Percentage items must add up to exactly 100% of the course fee (currently ${Number(sum.toFixed(2))}%)`;
}

const feePlanItemsSchema = z
  .array(feePlanItemSchema)
  .min(1)
  .superRefine((items, ctx) => {
    const message = percentSumError(items);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

export const createFeePlanSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  currency: z.string().length(3).default("INR"),
  isActive: z.boolean().default(true),
  courseId: z.string().uuid().nullable().optional(),
  items: feePlanItemsSchema,
  metadata: z.record(z.unknown()).optional(),
});

export const updateFeePlanSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional().nullable(),
  currency: z.string().length(3).optional(),
  isActive: z.boolean().optional(),
  courseId: z.string().uuid().nullable().optional(),
  items: feePlanItemsSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const feePlanFiltersSchema = z.object({
  search: z.string().max(255).optional(),
  courseId: z.string().uuid().optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export type CreateFeePlanInput = z.infer<typeof createFeePlanSchema>;
export type UpdateFeePlanInput = z.infer<typeof updateFeePlanSchema>;
export type FeePlanFilters = z.infer<typeof feePlanFiltersSchema>;
