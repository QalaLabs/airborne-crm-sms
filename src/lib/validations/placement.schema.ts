import { z } from "zod";

export const placementStatusValues = ["PENDING", "CONFIRMED", "CANCELLED"] as const;

export const createHiringPartnerSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().max(255).regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens").optional(),
  logoId: z.string().uuid().optional(),
  website: z.string().url().max(500).optional(),
  industry: z.string().max(100).optional(),
  description: z.string().max(5000).optional(),
  isActive: z.boolean().default(true),
  order: z.number().int().min(0).default(0),
});

const clearableText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v === "" ? null : v));

// Edit form sends "" to clear optional fields; name/slug can never be blanked.
export const updateHiringPartnerSchema = z
  .object({
    name: z.string().trim().min(1, "Partner name is required").max(255),
    slug: z
      .string()
      .trim()
      .min(2, "Code must be at least 2 characters")
      .max(255)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Code must be lowercase letters, digits and single hyphens"),
    logoId: z.union([z.string().uuid(), z.null()]),
    website: z
      .union([z.string().trim().url("Website must be a valid URL").max(500), z.literal(""), z.null()])
      .transform((v) => (v === "" ? null : v)),
    industry: clearableText(100),
    description: clearableText(5000),
    isActive: z.boolean(),
    order: z.number().int().min(0),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "No changes supplied" });

export const hiringPartnerFiltersSchema = z.object({
  search: z.string().optional(),
  isActive: z.boolean().optional(),
  industry: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "updatedAt", "name", "order"]).default("order"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
});

export const createPlacementSchema = z.object({
  studentId: z.string().uuid(),
  hiringPartnerId: z.string().uuid().optional(),
  jobTitle: z.string().min(1).max(255),
  package: z.number().positive().optional(),
  currency: z.string().length(3).default("INR"),
  joiningDate: z.string().datetime().optional(),
  status: z.enum(placementStatusValues).default("PENDING"),
  isPublic: z.boolean().default(false),
  batchYear: z.number().int().min(2000).max(2100).optional(),
  notes: z.string().max(5000).optional(),
});

export const updatePlacementSchema = createPlacementSchema.partial();

export const placementFiltersSchema = z.object({
  studentId: z.string().uuid().optional(),
  hiringPartnerId: z.string().uuid().optional(),
  status: z.enum(placementStatusValues).optional(),
  batchYear: z.coerce.number().int().optional(),
  isPublic: z.boolean().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "updatedAt", "joiningDate", "package"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateHiringPartnerInput = z.infer<typeof createHiringPartnerSchema>;
export type UpdateHiringPartnerInput = z.output<typeof updateHiringPartnerSchema>;
export type HiringPartnerFilters = z.infer<typeof hiringPartnerFiltersSchema>;
export type CreatePlacementInput = z.infer<typeof createPlacementSchema>;
export type UpdatePlacementInput = z.infer<typeof updatePlacementSchema>;
export type PlacementFilters = z.infer<typeof placementFiltersSchema>;
