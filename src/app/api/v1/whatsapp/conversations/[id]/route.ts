import { type NextRequest } from "next/server";
import { z } from "zod";
import { WhatsAppService } from "@/lib/services/whatsapp.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { sendMessageSchema, updateConversationSchema } from "@/lib/validations/whatsapp.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "leads");

    const result = await WhatsAppService.getMessages(ctx.orgId, id);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}

// markRead / archive toggle
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "leads");

    const body = await req.json() as unknown;
    const input = updateConversationSchema.parse(body);

    const conversation = await WhatsAppService.updateConversation(ctx, id, input);
    return ok(conversation);
  } catch (err) {
    return handleError(err);
  }
}

// Manual free-form send
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "leads");

    const body = await req.json() as unknown;
    const { body: text } = sendMessageSchema.parse(body);

    const result = await WhatsAppService.sendMessage(ctx, id, text);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
