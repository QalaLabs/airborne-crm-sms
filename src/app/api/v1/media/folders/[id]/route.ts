import { type NextRequest } from "next/server";
import { MediaFolderService } from "@/lib/services/media.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateFolderSchema } from "@/lib/validations/media.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "media");

    const folder = await MediaFolderService.getById(ctx, id);
    return ok(folder);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "media");

    const body = await req.json() as unknown;
    const input = updateFolderSchema.parse(body);

    const folder = await MediaFolderService.update(ctx, id, input);
    return ok(folder);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "media");

    await MediaFolderService.delete(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
