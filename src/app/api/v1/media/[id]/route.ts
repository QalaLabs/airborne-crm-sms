import { type NextRequest } from "next/server";
import { MediaService } from "@/lib/services/media.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateAssetSchema } from "@/lib/validations/media.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "media");

    const asset = await MediaService.getById(ctx, id);
    return ok(asset);
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
    const input = updateAssetSchema.parse(body);

    const asset = await MediaService.update(ctx, id, input);
    return ok(asset);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "media");

    await MediaService.delete(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
