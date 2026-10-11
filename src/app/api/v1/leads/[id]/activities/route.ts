import { type NextRequest } from "next/server";
import { LeadService } from "@/lib/services/lead.service";
import { guard, getCounselorCondition, guardRecord } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { createActivitySchema } from "@/lib/validations/lead.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "leads");

    const lead = await LeadService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "read", "leads", lead as unknown as Record<string, unknown>, condition);

    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(50, parseInt(url.searchParams.get("limit") ?? "20", 10));

    const { data, total } = await LeadService.listActivities(ctx, id, page, limit);
    const meta = buildPaginationMeta(total, page, limit);

    return ok(data, meta);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "leads");

    const body = await req.json() as unknown;
    const input = createActivitySchema.parse(body);

    const existing = await LeadService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "write", "leads", existing as unknown as Record<string, unknown>, condition);

    const activity = await LeadService.createActivity(ctx, id, input);
    return created(activity);
  } catch (err) {
    return handleError(err);
  }
}
