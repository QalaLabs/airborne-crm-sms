import { type NextRequest } from "next/server";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { LeadTrashService } from "@/lib/services/lead-trash.service";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "delete", "leads");
    const { id } = await params;
    return ok(await LeadTrashService.purgeOne(ctx, id));
  } catch (err) {
    return handleError(err);
  }
}
