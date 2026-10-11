import { type NextRequest } from "next/server";
import { PaymentService } from "@/lib/services/payment.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { refundPaymentSchema } from "@/lib/validations/payment.schema";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "payments");

    const body = (await req.json()) as unknown;
    const input = refundPaymentSchema.parse(body);

    const payment = await PaymentService.refund(ctx, id, input);
    return ok(payment);
  } catch (err) {
    return handleError(err);
  }
}