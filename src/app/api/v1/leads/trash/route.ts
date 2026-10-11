import { type NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { LeadTrashService } from "@/lib/services/lead-trash.service";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().max(255).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "delete", "leads");

    const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
    const { data, total, retentionDays } = await LeadTrashService.list(ctx, query);

    const { totalPages } = buildPaginationMeta(total, query.page, query.limit);
    return ok({ items: data, total, totalPages, retentionDays });
  } catch (err) {
    return handleError(err);
  }
}
