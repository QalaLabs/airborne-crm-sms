import { type NextRequest } from "next/server";
import { z } from "zod";
import { WhatsAppService } from "@/lib/services/whatsapp.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

const patchSchema = z.object({
  whatsappNotifications: z.boolean(),
});

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "settings");

    const settings = await WhatsAppService.getSettings(ctx.orgId);
    return ok(settings);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "settings");

    const body = await req.json() as unknown;
    const { whatsappNotifications } = patchSchema.parse(body);
    const settings = await WhatsAppService.updateSettings(ctx, whatsappNotifications);
    return ok(settings);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "settings");

    const result = await WhatsAppService.testConnection();
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
