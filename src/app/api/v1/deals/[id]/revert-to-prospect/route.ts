import { type NextRequest } from "next/server";
import { DealService } from "@/lib/services/deal.service";
import { guard, getCounselorCondition, guardRecord } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { revertDealToProspectSchema } from "@/lib/validations/deal.schema";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "deals");

    const body = (await req.json()) as unknown;
    const input = revertDealToProspectSchema.parse(body);

    const existing = await DealService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "write", "deals", existing as unknown as Record<string, unknown>, condition);

    const result = await DealService.revertToProspect(ctx, id, input);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}