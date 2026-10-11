import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createLmsCourseSchema } from "@/lib/validations/lms.schema";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms_courses");
    const data = await LmsService.listCourses(ctx);
    return ok(data);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const body = (await req.json()) as unknown;
    const input = createLmsCourseSchema.parse(body);
    const course = await LmsService.createCourse(ctx, input);
    return created(course);
  } catch (err) {
    return handleError(err);
  }
}
