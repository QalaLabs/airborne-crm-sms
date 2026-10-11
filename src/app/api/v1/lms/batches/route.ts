import { type NextRequest } from "next/server";
import { LmsOpsService } from "@/lib/services/lms-ops.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createBatchSchema } from "@/lib/validations/lms.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms");
    const courseId = new URL(req.url).searchParams.get("courseId") ?? undefined;
    const batches = await LmsOpsService.listBatches(ctx, courseId);
    return ok(batches);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const input = createBatchSchema.parse(await req.json());
    const batch = await LmsOpsService.createBatch(ctx, input);
    return created(batch);
  } catch (err) {
    return handleError(err);
  }
}
