import { type NextRequest } from "next/server";
import { JobApplicationService } from "@/lib/services/job.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createJobApplicationSchema, jobApplicationFiltersSchema } from "@/lib/validations/job.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "job_applications");
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const filters = jobApplicationFiltersSchema.parse(params);
    return ok(await JobApplicationService.list(ctx, filters));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "job_applications");
    const body = await req.json() as unknown;
    const input = createJobApplicationSchema.parse(body);
    return created(await JobApplicationService.submit(ctx, input));
  } catch (err) {
    return handleError(err);
  }
}
