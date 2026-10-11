import { type NextRequest } from "next/server";
import { getLeadInteraktStatus } from "@/lib/automation/interakt-automations";
import { LeadService } from "@/lib/services/lead.service";
import { guard, getCounselorCondition, guardRecord } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "leads");

    const lead = await LeadService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "read", "leads", lead as unknown as Record<string, unknown>, condition);

    const status = await getLeadInteraktStatus(ctx.orgId, id);
    return ok(status);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "leads");

    const lead = await LeadService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "write", "leads", lead as unknown as Record<string, unknown>, condition);

    const { emitLeadCreated } = await import("@/lib/automation/emit-lead-created");
    await emitLeadCreated({
      orgId: ctx.orgId,
      leadId: lead.id,
      leadName: lead.name,
      source: lead.source,
      courseInterest: lead.courseInterest,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
    });

    return ok({ success: true, message: "Interakt template trigger sent successfully" });
  } catch (err) {
    return handleError(err);
  }
}
