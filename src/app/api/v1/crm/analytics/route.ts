import { type NextRequest } from "next/server";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { parseAnalyticsRange } from "@/lib/analytics/date-range";
import { buildAnalyticsReport } from "@/lib/analytics/report.service";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "analytics");

    const range = parseAnalyticsRange(req.nextUrl.searchParams);
    const report = await buildAnalyticsReport({ id: ctx.user.id ?? "", role: ctx.user.role }, ctx.orgId, range);
    return ok(report);
  } catch (err) {
    return handleError(err);
  }
}
