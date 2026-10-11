import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { ForbiddenError, NotFoundError } from "@/lib/utils/errors";
import { parseAnalyticsRange } from "@/lib/analytics/date-range";
import { buildWebsiteTraffic } from "@/lib/analytics/ga4";
import { buildAnalyticsScope } from "@/lib/analytics/scope";

/**
 * GET /api/v1/crm/analytics/traffic?from=&to= - GA4 website traffic for the
 * caller's organization. Website traffic is org-wide, so counselor-scoped
 * analytics users are refused. GA4 failures are a 200 with a typed status.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "analytics");
    if (buildAnalyticsScope({ id: ctx.user.id ?? "", role: ctx.user.role }, ctx.orgId).isCounselor) {
      throw new ForbiddenError("read", "website traffic");
    }

    const range = parseAnalyticsRange(req.nextUrl.searchParams);
    const org = await prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { slug: true } });
    if (!org) throw new NotFoundError("Organization", ctx.orgId);

    return ok(await buildWebsiteTraffic(org.slug, range));
  } catch (err) {
    return handleError(err);
  }
}
