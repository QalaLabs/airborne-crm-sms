import { type NextRequest } from "next/server";
import { LeadService } from "@/lib/services/lead.service";
import { guard, getCounselorCondition, guardRecord } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateLeadSchema } from "@/lib/validations/lead.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "leads");

    const lead = await LeadService.getById(ctx, id);

    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "read", "leads", lead as unknown as Record<string, unknown>, condition);

    return ok(lead);
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
    const input = updateLeadSchema.parse(body);

    const existing = await LeadService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "write", "leads", existing as unknown as Record<string, unknown>, condition);

    const lead = await LeadService.update(ctx, id, input);
    return ok(lead);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "leads");

    const existing = await LeadService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "delete", "leads", existing as unknown as Record<string, unknown>, condition);

    await LeadService.delete(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
