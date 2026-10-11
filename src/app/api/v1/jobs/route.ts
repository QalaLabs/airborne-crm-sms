import { type NextRequest } from "next/server";
import { JobService } from "@/lib/services/job.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createJobSchema, jobFiltersSchema } from "@/lib/validations/job.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "jobs");
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const filters = jobFiltersSchema.parse(params);
    return ok(await JobService.list(ctx, filters));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "jobs");
    const body = await req.json() as unknown;
    const input = createJobSchema.parse(body);
    return created(await JobService.create(ctx, input));
  } catch (err) {
    return handleError(err);
  }
}
