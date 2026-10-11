import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

/** GET /api/v1/lms/attendance/courses - courses the caller may take attendance for. */
export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms_attendance");
    return ok(await LmsService.listAttendanceCourses(ctx));
  } catch (err) {
    return handleError(err);
  }
}
