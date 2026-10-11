import { type NextRequest } from "next/server";
import { WorkflowService } from "@/lib/services/workflow.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { runFiltersSchema, runNowSchema } from "@/lib/validations/workflow.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "workflows");

    const url = new URL(req.url);
    const filters = runFiltersSchema.parse(Object.fromEntries(url.searchParams));
    const { data, total } = await WorkflowService.listRuns(ctx, { ...filters, workflowId: id });
    return ok(data, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}

// Manual "Run now" — starts a dedup-free run of this workflow for one entity.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "workflows");

    const body = await req.json() as unknown;
    const input = runNowSchema.parse(body);
    const run = await WorkflowService.runNow(ctx, id, input);
    return created(run);
  } catch (err) {
    return handleError(err);
  }
}
