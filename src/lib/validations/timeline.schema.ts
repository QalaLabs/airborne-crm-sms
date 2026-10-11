import { z } from "zod";

// Unified timeline query — merges manual activities, outbound notifications
// and workflow runs for one entity into a single chronological stream.

export const timelineQuerySchema = z.object({
  entityType: z.enum(["LEAD", "ADMISSION", "PAYMENT", "STUDENT"]),
  entityId: z.string().min(1).max(255),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
