import { type NextRequest } from "next/server";
import { NavService } from "@/lib/services/nav.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateNavMenuItemsSchema } from "@/lib/validations/nav.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "nav");

    const menu = await NavService.getById(ctx, id);
    return ok(menu);
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "nav");

    const body = await req.json() as unknown;
    const input = updateNavMenuItemsSchema.parse(body);

    const menu = await NavService.update(ctx, id, input);
    return ok(menu);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "nav");

    await NavService.delete(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
