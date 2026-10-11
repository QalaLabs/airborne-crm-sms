import { type NextRequest } from "next/server";
import { LeadService } from "@/lib/services/lead.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { createLeadSchema, leadFiltersSchema } from "@/lib/validations/lead.schema";
import { applyLeadReadScope } from "@/lib/leads/lead-scope";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "leads");

    const url = new URL(req.url);
    const rawFilters = Object.fromEntries(url.searchParams.entries());
    const filters = applyLeadReadScope(ctx.user, leadFiltersSchema.parse(rawFilters));

    const { data, total } = await LeadService.list(ctx, filters);
    const meta = buildPaginationMeta(total, filters.page, filters.limit);

    return ok(data, meta);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "leads");

    const body = await req.json() as unknown;
    const input = createLeadSchema.parse(body);

    const lead = await LeadService.create(ctx, input);
    return created(lead);
  } catch (err) {
    return handleError(err);
  }
}
