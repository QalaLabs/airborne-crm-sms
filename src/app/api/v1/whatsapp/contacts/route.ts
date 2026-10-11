import { type NextRequest } from "next/server";
import { WhatsAppService } from "@/lib/services/whatsapp.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { contactFiltersSchema } from "@/lib/validations/whatsapp.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "leads");

    const url = new URL(req.url);
    const filters = contactFiltersSchema.parse(Object.fromEntries(url.searchParams));

    const { data, total } = await WhatsAppService.listContacts(ctx.orgId, filters);
    return ok(data, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}
