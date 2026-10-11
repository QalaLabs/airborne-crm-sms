import { z } from "zod";

const NO_MARKUP = /^[^<>]*$/;

/**
 * Public testimonial submission. Deliberately has no status / isFeatured /
 * order / avatarId / orgId fields: those are server-controlled, and unknown keys
 * are stripped by zod so a caller cannot smuggle them in.
 */
export const publicTestimonialSchema = z.object({
  authorName: z.string().trim().min(2).max(120).regex(NO_MARKUP, "name must not contain markup"),
  authorTitle: z.string().trim().max(120).regex(NO_MARKUP, "title must not contain markup").optional()
    .or(z.literal("").transform(() => undefined)),
  authorEmail: z.string().trim().toLowerCase().email().max(255).optional()
    .or(z.literal("").transform(() => undefined)),
  content: z.string().trim().min(20, "please write at least 20 characters").max(2000).regex(NO_MARKUP, "testimonial must not contain markup"),
  rating: z.number().int().min(1).max(5).optional(),
  courseId: z.string().uuid().optional(),
  batchYear: z.number().int().min(1990).max(2100).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: "consent is required" }) }),
});

export type PublicTestimonialInput = z.infer<typeof publicTestimonialSchema>;
