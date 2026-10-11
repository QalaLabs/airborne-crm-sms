import { type NextRequest } from "next/server";
import { LeadService } from "@/lib/services/lead.service";
import { guard, getCounselorCondition, guardRecord } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { convertLeadSchema } from "@/lib/validations/lead.schema";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "leads");
    guard(ctx.user, "write", "admissions");

    const body = (await req.json().catch(() => ({}))) as unknown;
    const input = convertLeadSchema.parse(body ?? {});

    const existing = await LeadService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "write", "leads", existing as unknown as Record<string, unknown>, condition);

    const result = await LeadService.convertToAdmission(ctx, id, input);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
