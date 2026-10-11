import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

/** Current student portal profile + dashboard payload. */
export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms");
    const data = await LmsService.me(ctx);
    return ok(data);
  } catch (err) {
    return handleError(err);
  }
}
