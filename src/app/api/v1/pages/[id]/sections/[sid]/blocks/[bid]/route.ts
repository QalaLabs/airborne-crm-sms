import { type NextRequest } from "next/server";
import { PageService } from "@/lib/services/page.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updatePageBlockSchema } from "@/lib/validations/page.schema";

type Params = { params: Promise<{ id: string; sid: string; bid: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id, sid, bid } = await params;
    guard(ctx.user, "write", "pages");

    const body = await req.json() as unknown;
    const input = updatePageBlockSchema.parse(body);

    const block = await PageService.updateBlock(ctx, id, sid, bid, input);
    return ok(block);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id, sid, bid } = await params;
    guard(ctx.user, "write", "pages");

    await PageService.deleteBlock(ctx, id, sid, bid);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
