import { type NextRequest } from "next/server";
import { LmsOpsService } from "@/lib/services/lms-ops.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createAssignmentSchema } from "@/lib/validations/lms.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms_assignments");
    const url = new URL(req.url);
    return ok(
      await LmsOpsService.listAssignments(ctx, {
        courseId: url.searchParams.get("courseId") ?? undefined,
        batchId: url.searchParams.get("batchId") ?? undefined,
      }),
    );
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_assignments");
    const input = createAssignmentSchema.parse(await req.json());
    return created(await LmsOpsService.createAssignment(ctx, input));
  } catch (err) {
    return handleError(err);
  }
}
