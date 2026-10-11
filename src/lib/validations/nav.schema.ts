import { z } from "zod";
import { safeHref } from "@/lib/cms/safe-content";

const navItemSchema: z.ZodType<NavItem> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    label: z.string().min(1).max(255),
    url: z
      .string()
      .min(1)
      .max(2048)
      .refine((u) => safeHref(u) !== null, "Use a site path (/courses), #anchor, or an http(s), mailto: or tel: link"),
    target: z.enum(["_self", "_blank"]).optional().default("_self"),
    icon: z.string().max(100).nullable().optional(),
    isVisible: z.boolean().optional().default(true),
    children: z.array(navItemSchema).optional().default([]),
  }),
);

export interface NavItem {
  id: string;
  label: string;
  url: string;
  target?: "_self" | "_blank";
  icon?: string | null;
  isVisible?: boolean;
  children?: NavItem[];
}

export const navLocationValues = ["header", "footer", "sidebar"] as const;
export type NavLocation = typeof navLocationValues[number];

export const createNavMenuSchema = z.object({
  name: z.string().min(1).max(255),
  location: z.enum(navLocationValues),
  items: z.array(navItemSchema).optional().default([]),
});
export type CreateNavMenuInput = z.infer<typeof createNavMenuSchema>;

export const updateNavMenuItemsSchema = z.object({
  items: z.array(navItemSchema),
  name: z.string().min(1).max(255).optional(),
});
export type UpdateNavMenuInput = z.infer<typeof updateNavMenuItemsSchema>;
