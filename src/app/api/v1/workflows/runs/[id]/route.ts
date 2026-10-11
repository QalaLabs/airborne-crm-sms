import { type NextRequest } from "next/server";
import { WorkflowService } from "@/lib/services/workflow.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { runActionSchema } from "@/lib/validations/workflow.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "workflows");

    const run = await WorkflowService.getRunById(ctx, id);
    return ok(run);
  } catch (err) {
    return handleError(err);
  }
}

// pause | resume | cancel
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "workflows");

    const body = await req.json() as unknown;
    const { action } = runActionSchema.parse(body);
    const run = await WorkflowService.runAction(ctx, id, action);
    return ok(run);
  } catch (err) {
    return handleError(err);
  }
}
