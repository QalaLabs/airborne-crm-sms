import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import { LeadService } from "@/lib/services/lead.service";
import { guard, guardRecord, getCounselorCondition } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { scheduleMeetingSchema } from "@/lib/validations/lead.schema";

const MEETING_SELECT = {
  id: true,
  leadId: true,
  performedBy: true,
  title: true,
  notes: true,
  outcome: true,
  nextAction: true,
  dueAt: true,
  completedAt: true,
  durationMins: true,
  metadata: true,
  createdAt: true,
  lead: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      courseInterest: true,
      status: true,
      campusId: true,
      assignedTo: true,
      counselor: { select: { id: true, name: true } },
    },
  },
  performer: { select: { id: true, name: true, avatarUrl: true } },
} as const;

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "leads");

    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") ?? "upcoming";
    const q = url.searchParams.get("q")?.trim();
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));
    const now = new Date();

    // Build the lead-relation filter (counselor ownership AND optional search)
    // as a relational AND so pagination stays correct in the DB query.
    const leadConditions: Prisma.LeadWhereInput = {};
    if (ctx.user.role === "ADMISSIONS_COUNSELOR") {
      leadConditions.assignedTo = ctx.user.id;
    }
    if (q) {
      leadConditions.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }

    const where: Prisma.LeadActivityWhereInput = {
      orgId: ctx.orgId,
      activityType: "MEETING",
      ...(Object.keys(leadConditions).length > 0 ? { lead: { is: leadConditions } } : {}),
    };

    if (scope === "upcoming") {
      where.completedAt = null;
      where.OR = [{ dueAt: null }, { dueAt: { gte: now } }];
    } else if (scope === "past") {
      where.OR = [{ completedAt: { not: null } }, { dueAt: { lt: now } }];
    }

    const meetings = await prisma.leadActivity.findMany({
      where,
      select: MEETING_SELECT,
      orderBy:
        scope === "upcoming"
          ? [{ dueAt: { sort: "asc", nulls: "last" } as const }]
          : [{ completedAt: { sort: "desc", nulls: "last" } as const }, { dueAt: "desc" }],
      take: limit,
    });

    return ok({ scope, meetings });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "leads");

    const body = (await req.json()) as unknown;
    const input = scheduleMeetingSchema.parse(body);

    const existing = await LeadService.getById(ctx, input.leadId);
    guardRecord(ctx.user, "write", "leads", existing as unknown as Record<string, unknown>, getCounselorCondition(ctx.user));

    const activity = await LeadService.scheduleMeeting(ctx, input.leadId, {
      title: input.title,
      dueAt: input.dueAt,
      durationMins: input.durationMins,
      mode: input.mode,
      notes: input.notes,
      outcome: input.outcome,
      metadata: input.metadata,
    });

    return created(activity);
  } catch (err) {
    return handleError(err);
  }
}
