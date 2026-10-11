import { type NextRequest } from "next/server";
import { ResourceService } from "@/lib/services/resource.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateResourceSchema } from "@/lib/validations/resource.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "resources");
    return ok(await ResourceService.getById(ctx, id));
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "resources");
    const body = await req.json() as unknown;
    const input = updateResourceSchema.parse(body);
    return ok(await ResourceService.update(ctx, id, input));
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "resources");
    await ResourceService.delete(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
