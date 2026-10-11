import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { LeadService } from "@/lib/services/lead.service";
import { guard, guardRecord, getCounselorCondition } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { AppError, ValidationError } from "@/lib/utils/errors";
import { updateMeetingSchema } from "@/lib/validations/lead.schema";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const requestCtx = await getRequestContext();
    guard(requestCtx.user, "write", "leads");

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) throw new ValidationError([{ path: ["id"], message: "Invalid meeting id" }]);

    const meeting = await prisma.leadActivity.findFirst({
      where: { id, orgId: requestCtx.orgId, activityType: "MEETING" },
      select: { id: true, leadId: true, lead: { select: { assignedTo: true } } },
    });
    if (!meeting) throw new AppError("NOT_FOUND", "Meeting not found", 404);

    guardRecord(
      requestCtx.user,
      "write",
      "leads",
      { leadId: meeting.leadId, assignedTo: meeting.lead?.assignedTo ?? null } as unknown as Record<string, unknown>,
      getCounselorCondition(requestCtx.user),
    );

    const input = updateMeetingSchema.parse(await req.json());
    const updated = await LeadService.updateMeeting(requestCtx, meeting.leadId, id, {
      title: input.title,
      dueAt: input.dueAt,
      durationMins: input.durationMins,
      mode: input.mode,
      notes: input.notes,
      outcome: input.outcome,
      metadata: input.metadata,
    });

    return ok(updated);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const requestCtx = await getRequestContext();
    guard(requestCtx.user, "write", "leads");

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) throw new ValidationError([{ path: ["id"], message: "Invalid meeting id" }]);

    const meeting = await prisma.leadActivity.findFirst({
      where: { id, orgId: requestCtx.orgId, activityType: "MEETING" },
      select: { id: true, leadId: true, lead: { select: { assignedTo: true } } },
    });
    if (!meeting) throw new AppError("NOT_FOUND", "Meeting not found", 404);

    guardRecord(
      requestCtx.user,
      "write",
      "leads",
      { leadId: meeting.leadId, assignedTo: meeting.lead?.assignedTo ?? null } as unknown as Record<string, unknown>,
      getCounselorCondition(requestCtx.user),
    );

    // Cancel keeps the audit trail (LeadActivity is never hard-deleted).
    const cancelled = await LeadService.cancelMeeting(requestCtx, meeting.leadId, id);

    return ok({ ...cancelled, outcome: "CANCELLED", completedAt: cancelled.completedAt });
  } catch (err) {
    return handleError(err);
  }
}