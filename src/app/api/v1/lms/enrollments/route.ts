import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { enrollStudentSchema } from "@/lib/validations/lms.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms");
    const courseId = new URL(req.url).searchParams.get("courseId") ?? undefined;
    const enrollments = await LmsService.listEnrollments(ctx, courseId);
    return ok(enrollments);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms");
    const body = (await req.json()) as unknown;
    const input = enrollStudentSchema.parse(body);
    const enrollment = await LmsService.enroll(ctx, input);
    return created(enrollment);
  } catch (err) {
    return handleError(err);
  }
}
