import { type NextRequest } from "next/server";
import { WhatsAppService } from "@/lib/services/whatsapp.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { updateCampaignSchema } from "@/lib/validations/whatsapp.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "leads");

    const campaign = await WhatsAppService.getCampaign(ctx.orgId, id);
    return ok(campaign);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "leads");

    const body = await req.json() as unknown;
    const input = updateCampaignSchema.parse(body);

    const campaign = await WhatsAppService.updateCampaign(ctx, id, input);
    return ok(campaign);
  } catch (err) {
    return handleError(err);
  }
}

// Launch the campaign
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "leads");

    const campaign = await WhatsAppService.launchCampaign(ctx, id);
    return ok(campaign);
  } catch (err) {
    return handleError(err);
  }
}
