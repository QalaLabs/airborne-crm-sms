import { type NextRequest } from "next/server";
import { WorkflowService } from "@/lib/services/workflow.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { createWorkflowSchema, workflowFiltersSchema } from "@/lib/validations/workflow.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "workflows");

    const url = new URL(req.url);
    const filters = workflowFiltersSchema.parse(Object.fromEntries(url.searchParams));
    const { data, total } = await WorkflowService.list(ctx, filters);
    return ok(data, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "workflows");

    const body = await req.json() as unknown;
    const input = createWorkflowSchema.parse(body);
    const workflow = await WorkflowService.create(ctx, input);
    return created(workflow);
  } catch (err) {
    return handleError(err);
  }
}
