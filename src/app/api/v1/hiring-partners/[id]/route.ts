import { type NextRequest } from "next/server";
import { HiringPartnerService } from "@/lib/services/placement.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateHiringPartnerSchema } from "@/lib/validations/placement.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "hiring_partners");
    return ok(await HiringPartnerService.getById(ctx, id));
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "hiring_partners");
    const body = await req.json() as unknown;
    const input = updateHiringPartnerSchema.parse(body);
    return ok(await HiringPartnerService.update(ctx, id, input));
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "hiring_partners");
    await HiringPartnerService.delete(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
