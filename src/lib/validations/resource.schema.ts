import { z } from "zod";
import { isHttpUrl } from "@/lib/utils/safe-url";

export const resourceTypeValues = [
  "PDF", "VIDEO", "LINK", "IMAGE", "DOCUMENT", "AUDIO", "OTHER",
] as const;

export const resourceStatusValues = ["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"] as const;

export const createResourceSchema = z.object({
  title: z.string().min(1).max(255),
  slug: z.string().max(255).regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens").optional(),
  description: z.string().max(5000).optional(),
  type: z.enum(resourceTypeValues),
  fileUrl: z.string().url().max(2000).refine(isHttpUrl, "fileUrl must be an http(s) URL").optional(),
  externalUrl: z.string().url().max(2000).refine(isHttpUrl, "externalUrl must be an http(s) URL").optional(),
  thumbnailId: z.string().uuid().optional(),
  tags: z.array(z.string().max(50)).default([]),
  category: z.string().max(100).optional(),
  isGated: z.boolean().default(false),
  seoTitle: z.string().max(255).optional(),
  seoDesc: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const updateResourceSchema = createResourceSchema.partial();

export const publishResourceSchema = z.object({
  status: z.enum(resourceStatusValues),
  scheduledAt: z.string().datetime().optional(),
});

export const resourceFiltersSchema = z.object({
  search: z.string().optional(),
  type: z.enum(resourceTypeValues).optional(),
  category: z.string().optional(),
  status: z.enum(resourceStatusValues).optional(),
  isGated: z.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "updatedAt", "title", "downloadCount"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateResourceInput = z.infer<typeof createResourceSchema>;
export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;
export type PublishResourceInput = z.infer<typeof publishResourceSchema>;
export type ResourceFilters = z.infer<typeof resourceFiltersSchema>;
