import { type NextRequest } from "next/server";
import { BlockService } from "@/lib/services/block.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateBlockSchema } from "@/lib/validations/block.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "blocks");

    const block = await BlockService.getById(ctx, id);
    return ok(block);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "blocks");

    const body = await req.json() as unknown;
    const input = updateBlockSchema.parse(body);

    const block = await BlockService.update(ctx, id, input);
    return ok(block);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "blocks");

    await BlockService.delete(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
