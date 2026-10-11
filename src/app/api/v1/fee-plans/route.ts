import { type NextRequest } from "next/server";
import { FeePlanService } from "@/lib/services/fee-plan.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { createFeePlanSchema, feePlanFiltersSchema } from "@/lib/validations/fee-plan.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "admissions");

    const url = new URL(req.url);
    const filters = feePlanFiltersSchema.parse(Object.fromEntries(url.searchParams));
    const { data, total } = await FeePlanService.list(ctx, filters);
    return ok(data, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "admissions");

    const body = await req.json() as unknown;
    const input = createFeePlanSchema.parse(body);
    const plan = await FeePlanService.create(ctx, input);
    return created(plan);
  } catch (err) {
    return handleError(err);
  }
}
