import { z } from "zod";

export const testimonialStatusValues = ["PENDING", "APPROVED", "REJECTED"] as const;

export const createTestimonialSchema = z.object({
  studentId: z.string().uuid().optional(),
  authorName: z.string().min(1).max(255),
  authorTitle: z.string().max(255).optional(),
  authorEmail: z.string().email().max(255).optional(),
  content: z.string().min(10).max(5000),
  rating: z.number().int().min(1).max(5).optional(),
  avatarId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  batchYear: z.number().int().min(2000).max(2100).optional(),
  source: z.string().max(100).optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const updateTestimonialSchema = createTestimonialSchema.partial().extend({
  avatarId: z.string().uuid().nullable().optional(),
  isFeatured: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
});

export const reviewTestimonialSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"] as const),
  reviewNotes: z.string().max(2000).optional(),
});

export const testimonialFiltersSchema = z.object({
  status: z.enum(testimonialStatusValues).optional(),
  courseId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  isFeatured: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
    .optional(),
  batchYear: z.coerce.number().int().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "updatedAt", "order", "rating"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateTestimonialInput = z.infer<typeof createTestimonialSchema>;
export type UpdateTestimonialInput = z.infer<typeof updateTestimonialSchema>;
export type ReviewTestimonialInput = z.infer<typeof reviewTestimonialSchema>;
export type TestimonialFilters = z.infer<typeof testimonialFiltersSchema>;
