import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { created, handleError } from "@/lib/utils/response";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ moduleId: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const { moduleId } = await params;
    return created(await LmsService.duplicateModule(ctx, moduleId));
  } catch (err) {
    return handleError(err);
  }
}
