import { type NextRequest } from "next/server";
import { WhatsAppService } from "@/lib/services/whatsapp.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createTemplateSchema } from "@/lib/validations/whatsapp.schema";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "notifications");

    const templates = await WhatsAppService.listTemplates(ctx.orgId);
    return ok(templates);
  } catch (err) {
    return handleError(err);
  }
}

// Upsert on (org, event, channel) — one active template per event.
export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "notifications");

    const body = await req.json() as unknown;
    const input = createTemplateSchema.parse(body);

    const template = await WhatsAppService.upsertTemplate(ctx, input);
    return created(template);
  } catch (err) {
    return handleError(err);
  }
}
