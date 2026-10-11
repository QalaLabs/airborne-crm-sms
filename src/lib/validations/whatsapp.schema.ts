import { z } from "zod";
import { NotificationEvent } from "@prisma/client";

// ─── WhatsApp module schemas ─────────────────────────────────────────────────

export const conversationFiltersSchema = z.object({
  archived: z.coerce.boolean().optional(),
  search: z.string().max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const sendMessageSchema = z.object({
  body: z.string().min(1).max(4096),
});

export const updateConversationSchema = z.object({
  markRead: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const contactFiltersSchema = z.object({
  search: z.string().max(255).optional(),
  optOut: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const updateContactSchema = z.object({
  whatsappOptOut: z.boolean(),
});

export const audienceFilterSchema = z
  .object({
    tags: z.array(z.string().min(1).max(100)).max(20).optional(),
    statuses: z.array(z.string().max(50)).max(20).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Audience filter needs at least one criterion" });

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  message: z.string().min(1).max(4096),
  templateName: z.string().max(255).optional(),
  audienceFilter: audienceFilterSchema,
});

export const updateCampaignSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  message: z.string().min(1).max(4096).optional(),
  templateName: z.string().max(255).nullable().optional(),
  audienceFilter: audienceFilterSchema.optional(),
});

export const campaignFiltersSchema = z.object({
  status: z.enum(["DRAFT", "LAUNCHING", "COMPLETED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

// ─── Templates (NotificationTemplate, channel WHATSAPP) ──────────────────────

const TEMPLATE_VARIABLE_RE = /\{\{\s*(\w+)\s*\}\}/g;

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  event: z.nativeEnum(NotificationEvent),
  body: z.string().min(1).max(4096),
  isActive: z.boolean().default(true),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  body: z.string().min(1).max(4096).optional(),
  isActive: z.boolean().optional(),
});

export function extractTemplateVariables(body: string): string[] {
  return Array.from(new Set(Array.from(body.matchAll(TEMPLATE_VARIABLE_RE), (m) => m[1] ?? "")));
}

export type ConversationFilters = z.infer<typeof conversationFiltersSchema>;
export type ContactFilters = z.infer<typeof contactFiltersSchema>;
export type CampaignFilters = z.infer<typeof campaignFiltersSchema>;
