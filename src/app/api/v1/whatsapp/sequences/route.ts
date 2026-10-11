import { WhatsAppService } from "@/lib/services/whatsapp.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

// Sequences are workflows with a `seq-` code prefix. The 21-day nurture
// sequence is seeded via `npm run db:seed:workflows` in Phase 4.
export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "workflows");

    const sequences = await WhatsAppService.listSequences(ctx.orgId);
    return ok(sequences);
  } catch (err) {
    return handleError(err);
  }
}
