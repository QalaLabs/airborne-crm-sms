import { type NextRequest } from "next/server";
import { WhatsAppService } from "@/lib/services/whatsapp.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { updateContactSchema } from "@/lib/validations/whatsapp.schema";

type Params = { params: Promise<{ id: string }> };

// Opt-out / opt-in toggle — mirrors onto the conversation row so inbox sends
// are blocked for opted-out contacts.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "leads");

    const body = await req.json() as unknown;
    const { whatsappOptOut } = updateContactSchema.parse(body);

    const result = await WhatsAppService.updateContactOptOut(ctx, id, whatsappOptOut);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
