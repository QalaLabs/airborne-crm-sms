import { z } from "zod";
import { CONTENT_STATUS_TRANSITIONS } from "@/lib/validations/page.schema";

export { CONTENT_STATUS_TRANSITIONS };

const curriculumModuleSchema = z.object({
  module: z.string().min(1),
  topics: z.array(z.string()).default([]),
});

export const createCourseSchema = z.object({
  title: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens")
    .optional(),
  subtitle: z.string().max(500).optional(),
  description: z.string().optional(),
  category: z.string().max(100).optional(),
  duration: z.string().max(100).optional(),
  eligibility: z.string().optional(),
  curriculum: z.array(curriculumModuleSchema).optional().default([]),
  fee: z.coerce.number().positive().optional(),
  bannerImageId: z.string().uuid().optional(),
  galleryIds: z.array(z.string().uuid()).optional().default([]),
  seoTitle: z.string().max(255).optional(),
  seoDesc: z.string().max(500).optional(),
  seoKeywords: z.array(z.string()).optional().default([]),
  order: z.number().int().min(0).optional().default(0),
  isFeatured: z.boolean().optional().default(false),
  metadata: z.record(z.unknown()).optional().default({}),
  status: z.enum(["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"]).optional(),
  scheduledAt: z.string().datetime().optional(),
});
export type CreateCourseInput = z.infer<typeof createCourseSchema>;

export const updateCourseSchema = createCourseSchema.omit({ status: true, scheduledAt: true }).partial();
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;

export const publishCourseSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"]),
  scheduledAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});
export type PublishCourseInput = z.infer<typeof publishCourseSchema>;

export const courseFiltersSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"]).optional(),
  category: z.string().optional(),
  isFeatured: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "updatedAt", "title", "order"]).default("order"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
});
export type CourseFilters = z.infer<typeof courseFiltersSchema>;
