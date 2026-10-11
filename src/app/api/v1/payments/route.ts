import { type NextRequest } from "next/server";
import { PaymentService } from "@/lib/services/payment.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { paymentFiltersSchema } from "@/lib/validations/payment.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "payments");

    const url = new URL(req.url);
    const filters = paymentFiltersSchema.parse(Object.fromEntries(url.searchParams));

    const { data, total } = await PaymentService.list(ctx, filters);
    return ok(data, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}