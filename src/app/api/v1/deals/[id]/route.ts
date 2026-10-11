import { type NextRequest } from "next/server";
import { DealService } from "@/lib/services/deal.service";
import { guard, getCounselorCondition, guardRecord } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateDealSchema } from "@/lib/validations/deal.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "deals");

    const deal = await DealService.getById(ctx, id);

    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "read", "deals", deal as unknown as Record<string, unknown>, condition);

    return ok(deal);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "deals");

    const body = (await req.json()) as unknown;
    const input = updateDealSchema.parse(body);

    const existing = await DealService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "write", "deals", existing as unknown as Record<string, unknown>, condition);

    const deal = await DealService.update(ctx, id, input);
    return ok(deal);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "deals");

    const existing = await DealService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "delete", "deals", existing as unknown as Record<string, unknown>, condition);

    await DealService.delete(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}