import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { ACTIVE_LEAD_STATUSES } from "@/lib/leads/lead-status";
import type { ISTWeek } from "@/lib/leads/ist-week";

/** Per-section cap; totals are always exact so the UI can say when a list is truncated. */
export const AGENT_CALLING_SECTION_LIMIT = 500;

const AGENT_CALLING_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  status: true,
  source: true,
  courseInterest: true,
  createdAt: true,
  nextFollowUp: true,
  lastActivityAt: true,
  counselor: { select: { id: true, name: true } },
} satisfies Prisma.LeadSelect;

export type AgentCallingLead = Prisma.LeadGetPayload<{ select: typeof AGENT_CALLING_SELECT }>;

export interface AgentCallingWeek {
  week: { key: string; endKey: string; start: string; end: string; label: string };
  newLeads: AgentCallingLead[];
  newLeadsTotal: number;
  followUps: AgentCallingLead[];
  followUpsTotal: number;
}

export class AgentCallingService {
  /**
   * New leads created in the week plus active leads whose follow-up falls in
   * the week, newest first. `assignedTo` must already be scope-enforced.
   */
  static async week(orgId: string, week: ISTWeek, assignedTo?: string): Promise<AgentCallingWeek> {
    const base: Prisma.LeadWhereInput = {
      orgId,
      deletedAt: null,
      ...(assignedTo ? { assignedTo } : {}),
    };
    const range = { gte: week.start, lte: week.end };
    const newWhere: Prisma.LeadWhereInput = { ...base, status: "NEW", createdAt: range };
    const followWhere: Prisma.LeadWhereInput = {
      ...base,
      status: { in: ACTIVE_LEAD_STATUSES },
      nextFollowUp: range,
    };

    const [newLeads, newLeadsTotal, followUps, followUpsTotal] = await Promise.all([
      prisma.lead.findMany({
        where: newWhere,
        select: AGENT_CALLING_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: AGENT_CALLING_SECTION_LIMIT,
      }),
      prisma.lead.count({ where: newWhere }),
      prisma.lead.findMany({
        where: followWhere,
        select: AGENT_CALLING_SELECT,
        orderBy: [{ nextFollowUp: "desc" }, { id: "desc" }],
        take: AGENT_CALLING_SECTION_LIMIT,
      }),
      prisma.lead.count({ where: followWhere }),
    ]);

    return {
      week: {
        key: week.key,
        endKey: week.endKey,
        start: week.start.toISOString(),
        end: week.end.toISOString(),
        label: week.label,
      },
      newLeads,
      newLeadsTotal,
      followUps,
      followUpsTotal,
    };
  }
}
