import { z } from "zod";
import type { ContentStatus } from "@prisma/client";

// ─── Status Transitions ───────────────────────────────────────────────────────

export const CONTENT_STATUS_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  DRAFT: ["PUBLISHED", "SCHEDULED", "ARCHIVED"],
  SCHEDULED: ["DRAFT", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["DRAFT", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export const createPageSchema = z.object({
  title: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens")
    .optional(),
  description: z.string().optional(),
  seoTitle: z.string().max(255).optional(),
  seoDesc: z.string().max(500).optional(),
  seoKeywords: z.array(z.string()).optional().default([]),
  ogImage: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
});
export type CreatePageInput = z.infer<typeof createPageSchema>;

export const updatePageSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  slug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  description: z.string().nullable().optional(),
  seoTitle: z.string().max(255).nullable().optional(),
  seoDesc: z.string().max(500).nullable().optional(),
  seoKeywords: z.array(z.string()).optional(),
  ogImage: z.string().url().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UpdatePageInput = z.infer<typeof updatePageSchema>;

export const publishPageSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"]),
  scheduledAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});
export type PublishPageInput = z.infer<typeof publishPageSchema>;

export const pageFiltersSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"]).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "updatedAt", "title"]).default("updatedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});
export type PageFilters = z.infer<typeof pageFiltersSchema>;

// ─── Layout Reorder ───────────────────────────────────────────────────────────

export const reorderLayoutSchema = z.object({
  sections: z
    .array(z.object({ id: z.string().uuid(), order: z.number().int().min(0) }))
    .optional(),
  blocks: z
    .record(
      z.string(), // sectionId
      z.array(z.object({ id: z.string().uuid(), order: z.number().int().min(0) })),
    )
    .optional(),
});
export type ReorderLayoutInput = z.infer<typeof reorderLayoutSchema>;

// ─── Sections ─────────────────────────────────────────────────────────────────

export const createSectionSchema = z.object({
  name: z.string().max(255).optional(),
  order: z.number().int().min(0).optional(),
  isVisible: z.boolean().optional().default(true),
  settings: z.record(z.unknown()).optional().default({}),
});
export type CreateSectionInput = z.infer<typeof createSectionSchema>;

export const updateSectionSchema = z.object({
  name: z.string().max(255).nullable().optional(),
  order: z.number().int().min(0).optional(),
  isVisible: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
});
export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;

// ─── Blocks ───────────────────────────────────────────────────────────────────

export const createPageBlockSchema = z.object({
  blockTypeId: z.string().uuid(),
  props: z.record(z.unknown()).optional().default({}),
  order: z.number().int().min(0).optional(),
  isVisible: z.boolean().optional().default(true),
});
export type CreatePageBlockInput = z.infer<typeof createPageBlockSchema>;

export const updatePageBlockSchema = z.object({
  props: z.record(z.unknown()).optional(),
  order: z.number().int().min(0).optional(),
  isVisible: z.boolean().optional(),
});
export type UpdatePageBlockInput = z.infer<typeof updatePageBlockSchema>;
