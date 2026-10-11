import { type NextRequest } from "next/server";
import { DealService } from "@/lib/services/deal.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { dealFiltersSchema, createDealInputSchema } from "@/lib/validations/deal.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "deals");

    const url = new URL(req.url);
    const rawFilters = Object.fromEntries(url.searchParams.entries());
    const filters = dealFiltersSchema.parse(rawFilters);

    // Counselors only see their own deals (ABAC assigned_to=self).
    if (ctx.user.role === "ADMISSIONS_COUNSELOR") {
      filters.assignedTo = ctx.user.id;
    }

    const { data, total } = await DealService.list(ctx, filters);
    const meta = buildPaginationMeta(total, filters.page, filters.limit);

    return ok(data, meta);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "deals");

    const body = (await req.json()) as unknown;
    const input = createDealInputSchema.parse(body);

    const { deal, created: isNew } = await DealService.create(ctx, input);
    if (!isNew) return ok(deal);
    return created(deal);
  } catch (err) {
    return handleError(err);
  }
}