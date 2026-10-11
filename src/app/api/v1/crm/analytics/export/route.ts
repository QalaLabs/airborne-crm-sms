import { type NextRequest } from "next/server";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { handleError } from "@/lib/utils/response";
import { parseAnalyticsRange } from "@/lib/analytics/date-range";
import { buildAnalyticsReport } from "@/lib/analytics/report.service";
import { analyticsCsvFilename, analyticsReportToCsv } from "@/lib/analytics/report-csv";
import { AuditService } from "@/lib/services/audit.service";

/** Server-side CSV of the same report (same guard, scope and range) as GET /crm/analytics. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "analytics");

    const range = parseAnalyticsRange(req.nextUrl.searchParams);
    const report = await buildAnalyticsReport({ id: ctx.user.id ?? "", role: ctx.user.role }, ctx.orgId, range);
    const csv = analyticsReportToCsv(report);
    const filename = analyticsCsvFilename(report);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "analytics.exported",
      entityType: "analytics",
      entityId: ctx.orgId,
      newValue: { from: report.range?.from ?? null, to: report.range?.to ?? null, scope: report.scope },
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
