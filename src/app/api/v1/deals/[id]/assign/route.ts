import { type NextRequest } from "next/server";
import { DealService } from "@/lib/services/deal.service";
import { guard, getCounselorCondition, guardRecord } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { assignLeadSchema } from "@/lib/validations/lead.schema";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "assign", "deals");

    const body = (await req.json()) as unknown;
    const { counselorId } = assignLeadSchema.parse(body);

    const existing = await DealService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "assign", "deals", existing as unknown as Record<string, unknown>, condition);

    const result = await DealService.assign(ctx, id, counselorId);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}