import { type NextRequest } from "next/server";
import { CampusService } from "@/lib/services/org.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateCampusSchema } from "@/lib/validations/org.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "campuses");

    const campus = await CampusService.getById(ctx, id);
    return ok(campus);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "campuses");

    const body = await req.json() as unknown;
    const input = updateCampusSchema.parse(body);

    const campus = await CampusService.update(ctx, id, input);
    return ok(campus);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "campuses");

    await CampusService.delete(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
