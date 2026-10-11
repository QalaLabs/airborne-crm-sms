import { type NextRequest } from "next/server";
import { CourseService } from "@/lib/services/course.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { createCourseSchema, courseFiltersSchema } from "@/lib/validations/course.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "courses");

    const url = new URL(req.url);
    const filters = courseFiltersSchema.parse(Object.fromEntries(url.searchParams));

    const { data, total } = await CourseService.list(ctx, filters);
    return ok(data, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "courses");

    const body = await req.json() as unknown;
    const input = createCourseSchema.parse(body);

    const course = await CourseService.create(ctx, input);
    return created(course);
  } catch (err) {
    return handleError(err);
  }
}
