import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { markAttendanceSchema } from "@/lib/validations/lms.schema";
import { ValidationError } from "@/lib/utils/errors";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms_attendance");
    const url = new URL(req.url);
    const courseId = url.searchParams.get("courseId");
    if (!courseId) throw new ValidationError([{ path: "courseId", message: "courseId is required" }]);
    const sessions = await LmsService.getAttendanceForCourse(ctx, courseId, {
      batchId: url.searchParams.get("batchId") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    return ok(sessions);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_attendance");
    const body = (await req.json()) as unknown;
    const input = markAttendanceSchema.parse(body);
    const session = await LmsService.markAttendance(ctx, input);
    return created(session);
  } catch (err) {
    return handleError(err);
  }
}
