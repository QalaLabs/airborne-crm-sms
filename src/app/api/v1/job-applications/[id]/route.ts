import { type NextRequest } from "next/server";
import { JobApplicationService } from "@/lib/services/job.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "job_applications");
    return ok(await JobApplicationService.getById(ctx, id));
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "job_applications");
    await JobApplicationService.delete(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
