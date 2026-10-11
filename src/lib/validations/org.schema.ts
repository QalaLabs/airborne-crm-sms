import { z } from "zod";

export const createOrgSchema = z.object({
  name: z.string().min(2).max(255),
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  domain: z.string().max(255).optional(),
  logoUrl: z.string().url().optional(),
  plan: z.enum(["STARTER", "PROFESSIONAL", "ENTERPRISE"]).default("STARTER"),
  parentOrgId: z.string().uuid().optional(),
});

export const updateOrgSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  domain: z.string().max(255).optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  settings: z.record(z.unknown()).optional(),
  featureFlags: z.record(z.unknown()).optional(),
});

export const createCampusSchema = z.object({
  name: z.string().min(2).max(255),
  code: z.string().min(2).max(20).regex(/^[A-Z0-9_-]+$/, "Code must be uppercase alphanumeric"),
  address: z.string().max(500).optional(),
  city: z.string().max(100),
  state: z.string().max(100),
  country: z.string().length(2).default("IN"),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  headCounselorId: z.string().uuid().optional(),
  timezone: z.string().default("Asia/Kolkata"),
  isActive: z.boolean().default(true),
});

export const updateCampusSchema = createCampusSchema.partial();

export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;
export type CreateCampusInput = z.infer<typeof createCampusSchema>;
export type UpdateCampusInput = z.infer<typeof updateCampusSchema>;
