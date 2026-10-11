import { type NextRequest } from "next/server";
import { TimelineService } from "@/lib/services/timeline.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { timelineQuerySchema } from "@/lib/validations/timeline.schema";

// Unified timeline: manual activities + outbound notifications + automation
// runs for one entity, merged into a single chronological stream.

const RESOURCE_BY_ENTITY_TYPE = {
  LEAD: "leads",
  ADMISSION: "admissions",
  PAYMENT: "payments",
  STUDENT: "students",
} as const;

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();

    const url = new URL(req.url);
    const query = timelineQuerySchema.parse(Object.fromEntries(url.searchParams));

    guard(ctx.user, "read", RESOURCE_BY_ENTITY_TYPE[query.entityType]);

    const { items, total } = await TimelineService.getTimeline(ctx.orgId, query);
    return ok(items, buildPaginationMeta(total, query.page, query.limit));
  } catch (err) {
    return handleError(err);
  }
}
