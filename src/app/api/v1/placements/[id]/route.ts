import { type NextRequest } from "next/server";
import { PlacementService } from "@/lib/services/placement.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updatePlacementSchema } from "@/lib/validations/placement.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "placements");
    return ok(await PlacementService.getById(ctx, id));
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "placements");
    const body = await req.json() as unknown;
    const input = updatePlacementSchema.parse(body);
    return ok(await PlacementService.update(ctx, id, input));
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "placements");
    await PlacementService.delete(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
