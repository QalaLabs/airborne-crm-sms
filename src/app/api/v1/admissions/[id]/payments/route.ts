import { type NextRequest } from "next/server";
import { PaymentService } from "@/lib/services/payment.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { createPaymentSchema, paymentFiltersSchema } from "@/lib/validations/payment.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id: admissionId } = await params;
    guard(ctx.user, "read", "payments");

    const url = new URL(req.url);

    // ?summary=true returns fee summary instead of list
    if (url.searchParams.get("summary") === "true") {
      const summary = await PaymentService.getSummaryByAdmission(ctx, admissionId);
      return ok(summary);
    }

    const filters = paymentFiltersSchema.parse({
      ...Object.fromEntries(url.searchParams),
      admissionId,
    });

    const { data, total } = await PaymentService.list(ctx, filters);
    return ok(data, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id: admissionId } = await params;
    guard(ctx.user, "write", "payments");

    const body = await req.json() as unknown;
    const input = createPaymentSchema.parse(body);

    const payment = await PaymentService.create(ctx, admissionId, input);
    return created(payment);
  } catch (err) {
    return handleError(err);
  }
}
