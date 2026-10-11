import { type NextRequest } from "next/server";
import { LeadService } from "@/lib/services/lead.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { bulkAssignLeadsSchema } from "@/lib/validations/lead.schema";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "assign", "leads");

    const body = (await req.json()) as unknown;
    const { leadIds, counselorId, note } = bulkAssignLeadsSchema.parse(body);

    const result = await LeadService.assignMany(ctx, leadIds, counselorId, note);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}