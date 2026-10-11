import { type NextRequest } from "next/server";
import { CourseService } from "@/lib/services/course.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "courses");

    const versions = await CourseService.listVersions(ctx, id);
    return ok(versions);
  } catch (err) {
    return handleError(err);
  }
}
