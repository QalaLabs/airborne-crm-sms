import { type NextRequest } from "next/server";
import { WorkflowService } from "@/lib/services/workflow.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { updateWorkflowSchema } from "@/lib/validations/workflow.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "workflows");

    const workflow = await WorkflowService.getById(ctx, id);
    return ok(workflow);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "workflows");

    const body = await req.json() as unknown;
    const input = updateWorkflowSchema.parse(body);
    const workflow = await WorkflowService.update(ctx, id, input);
    return ok(workflow);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "workflows");

    const result = await WorkflowService.delete(ctx, id);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
