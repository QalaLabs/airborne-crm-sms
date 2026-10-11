import { type NextRequest } from "next/server";
import { LeadService } from "@/lib/services/lead.service";
import { guard, getCounselorCondition, guardRecord } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { updateFollowUpSchema } from "@/lib/validations/lead.schema";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "leads");

    const body = await req.json() as unknown;
    const input = updateFollowUpSchema.parse(body);

    const existing = await LeadService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "write", "leads", existing as unknown as Record<string, unknown>, condition);

    const lead = await LeadService.updateFollowUp(ctx, id, input.nextFollowUp);
    return ok(lead);
  } catch (err) {
    return handleError(err);
  }
}
