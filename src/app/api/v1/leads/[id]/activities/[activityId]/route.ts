import { type NextRequest } from "next/server";
import { LeadService } from "@/lib/services/lead.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { completeActivitySchema } from "@/lib/validations/lead.schema";

type Params = { params: Promise<{ id: string; activityId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id, activityId } = await params;
    guard(ctx.user, "write", "leads");

    const body = (await req.json().catch(() => ({}))) as unknown;
    const input = completeActivitySchema.parse(body ?? {});

    const activity = await LeadService.completeActivity(ctx, id, activityId, input);
    return ok(activity);
  } catch (err) {
    return handleError(err);
  }
}
