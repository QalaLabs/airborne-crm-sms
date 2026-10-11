import { type NextRequest } from "next/server";
import { CourseService } from "@/lib/services/course.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { updateCourseSchema } from "@/lib/validations/course.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "courses");

    const course = await CourseService.getById(ctx, id);
    return ok(course);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "courses");

    const body = await req.json() as unknown;
    const input = updateCourseSchema.parse(body);

    const course = await CourseService.update(ctx, id, input);
    return ok(course);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "courses");

    const course = await CourseService.delete(ctx, id);
    return ok(course);
  } catch (err) {
    return handleError(err);
  }
}
