import { WhatsAppService } from "@/lib/services/whatsapp.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "leads");

    const overview = await WhatsAppService.getOverview(ctx.orgId);
    return ok(overview);
  } catch (err) {
    return handleError(err);
  }
}
