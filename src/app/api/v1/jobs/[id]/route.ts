import { type NextRequest } from "next/server";
import { JobService } from "@/lib/services/job.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateJobSchema } from "@/lib/validations/job.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "jobs");
    return ok(await JobService.getById(ctx, id));
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "jobs");
    const body = await req.json() as unknown;
    const input = updateJobSchema.parse(body);
    return ok(await JobService.update(ctx, id, input));
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "jobs");
    await JobService.delete(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
