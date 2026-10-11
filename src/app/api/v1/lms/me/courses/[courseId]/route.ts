import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms");
    const { courseId } = await params;
    const data = await LmsService.getMyCoursePlayer(ctx, courseId);
    return ok(data);
  } catch (err) {
    return handleError(err);
  }
}
