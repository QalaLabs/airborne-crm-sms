import { LmsOpsService } from "@/lib/services/lms-ops.service";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms");
    const student = await LmsService.resolveLinkedStudent(ctx);
    return ok(await LmsOpsService.studentAttendanceBreakdown(ctx, student.id));
  } catch (err) {
    return handleError(err);
  }
}
