import { type NextRequest } from "next/server";
import { CourseService } from "@/lib/services/course.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { publishCourseSchema } from "@/lib/validations/course.schema";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "publish", "courses");

    const body = await req.json() as unknown;
    const input = publishCourseSchema.parse(body);

    const result = await CourseService.publish(ctx, id, input);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
