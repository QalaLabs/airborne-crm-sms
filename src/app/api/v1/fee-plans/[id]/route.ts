import { type NextRequest } from "next/server";
import { FeePlanService } from "@/lib/services/fee-plan.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { updateFeePlanSchema } from "@/lib/validations/fee-plan.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "admissions");

    const plan = await FeePlanService.getById(ctx, id);
    return ok(plan);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "admissions");

    const body = await req.json() as unknown;
    const input = updateFeePlanSchema.parse(body);
    const plan = await FeePlanService.update(ctx, id, input);
    return ok(plan);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "admissions");

    return ok(await FeePlanService.remove(ctx, id));
  } catch (err) {
    return handleError(err);
  }
}
