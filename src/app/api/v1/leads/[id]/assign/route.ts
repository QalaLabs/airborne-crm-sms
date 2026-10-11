import { type NextRequest } from "next/server";
import { LeadService } from "@/lib/services/lead.service";
import { guard, getCounselorCondition, guardRecord } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { assignLeadSchema } from "@/lib/validations/lead.schema";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "assign", "leads");

    const body = await req.json() as unknown;
    const { counselorId } = assignLeadSchema.parse(body);

    const existing = await LeadService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "assign", "leads", existing as unknown as Record<string, unknown>, condition);

    const result = await LeadService.assign(ctx, id, counselorId);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
