import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms");
    const { id } = await params;
    const enrollment = await LmsService.unenroll(ctx, id);
    return ok(enrollment);
  } catch (err) {
    return handleError(err);
  }
}
