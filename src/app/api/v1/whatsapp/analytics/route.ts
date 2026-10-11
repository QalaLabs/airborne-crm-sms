import { type NextRequest } from "next/server";
import { WhatsAppService } from "@/lib/services/whatsapp.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { analyticsQuerySchema } from "@/lib/validations/whatsapp.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "analytics");

    const url = new URL(req.url);
    const { days } = analyticsQuerySchema.parse(Object.fromEntries(url.searchParams));

    const analytics = await WhatsAppService.getAnalytics(ctx.orgId, days);
    return ok(analytics);
  } catch (err) {
    return handleError(err);
  }
}
