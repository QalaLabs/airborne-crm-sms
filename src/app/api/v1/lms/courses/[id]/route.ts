import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateLmsCourseSchema } from "@/lib/validations/lms.schema";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms_courses");
    const { id } = await params;
    const course = await LmsService.getCourseTree(ctx, id);
    return ok(course);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const { id } = await params;
    const body = (await req.json()) as unknown;
    const input = updateLmsCourseSchema.parse(body);
    const course = await LmsService.updateCourse(ctx, id, input);
    return ok(course);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "delete", "lms_courses");
    const { id } = await params;
    await LmsService.deleteCourse(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
