import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ studentId: string }> },
) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms");
    const { studentId } = await params;
    const data = await LmsService.studentDashboard(ctx, studentId);
    return ok(data);
  } catch (err) {
    return handleError(err);
  }
}
