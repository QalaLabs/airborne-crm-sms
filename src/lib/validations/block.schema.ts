import { z } from "zod";

export const createBlockSchema = z.object({
  type: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, "type must be snake_case (e.g. hero_banner)"),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  schema: z.record(z.unknown()), // JSON Schema object
  defaultProps: z.record(z.unknown()).optional().default({}),
  category: z.string().max(100).optional(),
  isGlobal: z.boolean().optional().default(false),
});
export type CreateBlockInput = z.infer<typeof createBlockSchema>;

export const updateBlockSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  schema: z.record(z.unknown()).optional(),
  defaultProps: z.record(z.unknown()).optional(),
  category: z.string().max(100).nullable().optional(),
  isGlobal: z.boolean().optional(),
});
export type UpdateBlockInput = z.infer<typeof updateBlockSchema>;

export const blockFiltersSchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  isGlobal: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type BlockFilters = z.infer<typeof blockFiltersSchema>;
