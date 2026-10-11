import { type NextRequest } from "next/server";
import { JobApplicationService } from "@/lib/services/job.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { updateJobApplicationStatusSchema } from "@/lib/validations/job.schema";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "job_applications");
    const body = await req.json() as unknown;
    const input = updateJobApplicationStatusSchema.parse(body);
    return ok(await JobApplicationService.updateStatus(ctx, id, input));
  } catch (err) {
    return handleError(err);
  }
}
