import { type NextRequest } from "next/server";
import { WhatsAppService } from "@/lib/services/whatsapp.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { campaignFiltersSchema, createCampaignSchema } from "@/lib/validations/whatsapp.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "leads");

    const url = new URL(req.url);
    const filters = campaignFiltersSchema.parse(Object.fromEntries(url.searchParams));

    const { data, total } = await WhatsAppService.listCampaigns(ctx.orgId, filters);
    return ok(data, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "leads");

    const body = await req.json() as unknown;
    const input = createCampaignSchema.parse(body);

    const campaign = await WhatsAppService.createCampaign(ctx, input);
    return created(campaign);
  } catch (err) {
    return handleError(err);
  }
}
