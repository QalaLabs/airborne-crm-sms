import { LmsOpsService } from "@/lib/services/lms-ops.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "students");
    return ok(await LmsOpsService.facultyStudents(ctx));
  } catch (err) {
    return handleError(err);
  }
}
