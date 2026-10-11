import { type NextRequest } from "next/server";
import { PlacementService } from "@/lib/services/placement.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createPlacementSchema, placementFiltersSchema } from "@/lib/validations/placement.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "placements");
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const filters = placementFiltersSchema.parse(params);
    return ok(await PlacementService.list(ctx, filters));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "placements");
    const body = await req.json() as unknown;
    const input = createPlacementSchema.parse(body);
    return created(await PlacementService.create(ctx, input));
  } catch (err) {
    return handleError(err);
  }
}
