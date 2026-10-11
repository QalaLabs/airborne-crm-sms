import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit.service";
import { ConflictError, NotFoundError } from "@/lib/utils/errors";
import { leadTrashRetentionDays, trashPurgeAt, trashPurgeCutoff } from "@/lib/leads/lead-trash";
import type { RequestContext } from "@/types";

const TRASH_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  status: true,
  source: true,
  courseInterest: true,
  createdAt: true,
  deletedAt: true,
  counselor: { select: { id: true, name: true } },
  _count: { select: { admissions: true } },
} satisfies Prisma.LeadSelect;

export interface PurgeResult {
  purged: number;
  /** Leads kept because an admission references them (FK is RESTRICT). */
  skippedWithAdmission: number;
}

/**
 * Recycle Bin for soft-deleted leads. Permanent deletion cascades the lead's
 * activities, score history, deals and Interakt sync rows; leads referenced
 * by an admission are never hard-deleted.
 */
export class LeadTrashService {
  static async list(ctx: RequestContext, opts: { page: number; limit: number; search?: string }) {
    const retentionDays = leadTrashRetentionDays();
    // Opportunistic purge so expiry holds even where the cron is not scheduled.
    await this.purgeExpired(ctx.orgId).catch((err) => console.error("[LeadTrash] purge on list failed", err));

    const where: Prisma.LeadWhereInput = {
      orgId: ctx.orgId,
      deletedAt: { not: null },
      ...(opts.search
        ? {
            OR: [
              { name: { contains: opts.search, mode: "insensitive" } },
              { phone: { contains: opts.search } },
              { email: { contains: opts.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        select: TRASH_SELECT,
        orderBy: { deletedAt: "desc" },
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
      }),
      prisma.lead.count({ where }),
    ]);

    const data = rows.map(({ _count, ...lead }) => ({
      ...lead,
      hasAdmission: _count.admissions > 0,
      purgeAt: trashPurgeAt(lead.deletedAt!, retentionDays).toISOString(),
    }));
    return { data, total, retentionDays };
  }

  static async restore(ctx: RequestContext, id: string) {
    const lead = await this.findTrashed(ctx.orgId, id);
    await prisma.lead.update({ where: { id: lead.id }, data: { deletedAt: null } });
    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "lead.restored",
      entityType: "lead",
      entityId: lead.id,
      newValue: { name: lead.name, phone: lead.phone },
    });
    return { id: lead.id };
  }

  static async purgeOne(ctx: RequestContext, id: string) {
    const lead = await this.findTrashed(ctx.orgId, id);
    const admissions = await prisma.admission.count({ where: { leadId: lead.id } });
    if (admissions > 0) {
      throw new ConflictError("This lead has an admission record and cannot be permanently deleted. Restore it instead.");
    }
    await prisma.lead.delete({ where: { id: lead.id } });
    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "lead.purged",
      entityType: "lead",
      entityId: lead.id,
      oldValue: { name: lead.name, phone: lead.phone, deletedAt: lead.deletedAt?.toISOString() },
    });
    return { id: lead.id };
  }

  /** Hard-deletes leads past the retention window. Pass orgId to scope, omit for all orgs (cron). */
  static async purgeExpired(orgId?: string): Promise<PurgeResult> {
    const cutoff = trashPurgeCutoff(leadTrashRetentionDays());
    const base: Prisma.LeadWhereInput = {
      ...(orgId ? { orgId } : {}),
      deletedAt: { not: null, lt: cutoff },
    };

    const [expired, skippedWithAdmission] = await Promise.all([
      prisma.lead.findMany({ where: { ...base, admissions: { none: {} } }, select: { id: true, orgId: true }, take: 1000 }),
      prisma.lead.count({ where: { ...base, admissions: { some: {} } } }),
    ]);
    if (expired.length === 0) return { purged: 0, skippedWithAdmission };

    const { count } = await prisma.lead.deleteMany({
      where: { id: { in: expired.map((l) => l.id) }, deletedAt: { not: null, lt: cutoff } },
    });

    const perOrg = new Map<string, number>();
    for (const l of expired) perOrg.set(l.orgId, (perOrg.get(l.orgId) ?? 0) + 1);
    for (const [org, n] of perOrg) {
      await AuditService.write({
        orgId: org,
        action: "lead.auto_purged",
        entityType: "lead",
        newValue: { purged: n, cutoff: cutoff.toISOString() },
      }).catch(() => undefined);
    }

    return { purged: count, skippedWithAdmission };
  }

  private static async findTrashed(orgId: string, id: string) {
    const lead = await prisma.lead.findFirst({
      where: { id, orgId, deletedAt: { not: null } },
      select: { id: true, name: true, phone: true, deletedAt: true },
    });
    if (!lead) throw new NotFoundError("Deleted lead", id);
    return lead;
  }
}
