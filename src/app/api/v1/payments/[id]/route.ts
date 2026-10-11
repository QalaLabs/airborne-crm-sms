import { type NextRequest } from "next/server";
import { PaymentService } from "@/lib/services/payment.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { updatePaymentSchema } from "@/lib/validations/payment.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "payments");

    const payment = await PaymentService.getById(ctx, id);
    return ok(payment);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "payments");

    const body = await req.json() as unknown;
    const input = updatePaymentSchema.parse(body);

    const payment = await PaymentService.update(ctx, id, input);
    return ok(payment);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "payments");

    return ok(await PaymentService.remove(ctx, id));
  } catch (err) {
    return handleError(err);
  }
}
