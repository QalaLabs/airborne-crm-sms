import { HiringPartnerRepository, PlacementRepository } from "@/lib/repositories/placement.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { emitEvent } from "@/lib/events/inngest";
import { NotFoundError, ConflictError } from "@/lib/utils/errors";
import type {
  CreateHiringPartnerInput,
  UpdateHiringPartnerInput,
  HiringPartnerFilters,
  CreatePlacementInput,
  UpdatePlacementInput,
  PlacementFilters,
} from "@/lib/validations/placement.schema";
import type { RequestContext } from "@/types";
import { prisma } from "@/lib/db/client";

function generateSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/[\s]+/g, "-");
}

async function assertPartnerNameAvailable(orgId: string, name: string, excludeId?: string) {
  const clash = await prisma.hiringPartner.findFirst({
    where: { orgId, name: { equals: name.trim(), mode: "insensitive" }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ConflictError(`An airline partner named "${name.trim()}" already exists.`);
}

async function assertLogoInOrg(orgId: string, logoId: string | null | undefined) {
  if (!logoId) return;
  const asset = await prisma.mediaAsset.findFirst({ where: { id: logoId, orgId }, select: { id: true } });
  if (!asset) throw new NotFoundError("MediaAsset", logoId);
}

async function assertPlacementRefsInOrg(orgId: string, studentId?: string, hiringPartnerId?: string | null) {
  if (studentId) {
    const student = await prisma.student.findFirst({ where: { id: studentId, orgId, deletedAt: null }, select: { id: true } });
    if (!student) throw new NotFoundError("Student", studentId);
  }
  if (hiringPartnerId) {
    const partner = await prisma.hiringPartner.findFirst({ where: { id: hiringPartnerId, orgId }, select: { id: true } });
    if (!partner) throw new NotFoundError("HiringPartner", hiringPartnerId);
  }
}

const PARTNER_AUDIT_FIELDS = ["name", "slug", "logoId", "website", "industry", "description", "isActive", "order"] as const;

async function ensureUniquePartnerSlug(orgId: string, base: string, excludeId?: string): Promise<string> {
  let slug = base;
  let n = 1;
  for (;;) {
    const existing = await prisma.hiringPartner.findFirst({ where: { orgId, slug }, select: { id: true } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${++n}`;
  }
}

// ─── Hiring Partner Service ───────────────────────────────────────────────────

export class HiringPartnerService {
  static async list(ctx: RequestContext, filters: HiringPartnerFilters) {
    return HiringPartnerRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const partner = await HiringPartnerRepository.findById(ctx.orgId, id);
    if (!partner) throw new NotFoundError("HiringPartner", id);
    return partner;
  }

  static async create(ctx: RequestContext, input: CreateHiringPartnerInput) {
    await assertPartnerNameAvailable(ctx.orgId, input.name);
    await assertLogoInOrg(ctx.orgId, input.logoId);
    const baseSlug = input.slug ?? generateSlug(input.name);
    const slug = await ensureUniquePartnerSlug(ctx.orgId, baseSlug);

    const partner = await HiringPartnerRepository.create(ctx.orgId, ctx.user.id, input, slug);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "hiring_partner.created",
      entityType: "hiring_partner",
      entityId: partner.id,
      newValue: { name: partner.name, slug: partner.slug },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "created",
      objectType: "hiring_partner",
      objectId: partner.id,
      objectSnapshot: { name: partner.name },
      context: { actorName: ctx.user.name },
    });

    return partner;
  }

  static async update(ctx: RequestContext, id: string, input: UpdateHiringPartnerInput) {
    const existing = await this.getById(ctx, id);

    if (input.slug && input.slug !== existing.slug) {
      const conflict = await prisma.hiringPartner.findFirst({
        where: { orgId: ctx.orgId, slug: input.slug },
        select: { id: true },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictError(`Code "${input.slug}" is already used by another airline partner.`);
      }
    }
    if (input.name && input.name.trim().toLowerCase() !== existing.name.trim().toLowerCase()) {
      await assertPartnerNameAvailable(ctx.orgId, input.name, id);
    }
    if (input.logoId !== undefined) await assertLogoInOrg(ctx.orgId, input.logoId);

    // Jobs and placements reference the partner by id, so editing these columns
    // never detaches them.
    const updated = await HiringPartnerRepository.update(ctx.orgId, id, input);

    const changed = PARTNER_AUDIT_FIELDS.filter(
      (f) => input[f] !== undefined && input[f] !== (existing as Record<string, unknown>)[f],
    );
    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "hiring_partner.updated",
      entityType: "hiring_partner",
      entityId: id,
      oldValue: Object.fromEntries(changed.map((f) => [f, (existing as Record<string, unknown>)[f] ?? null])),
      newValue: Object.fromEntries(changed.map((f) => [f, input[f] ?? null])),
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "updated",
      objectType: "hiring_partner",
      objectId: id,
      objectSnapshot: { name: updated.name },
      context: { actorName: ctx.user.name, fields: changed },
    });

    return updated;
  }

  static async delete(ctx: RequestContext, id: string) {
    const existing = await this.getById(ctx, id);
    const hasJobs = await HiringPartnerRepository.hasActiveJobs(ctx.orgId, id);
    if (hasJobs) {
      throw new ConflictError("Cannot delete hiring partner with active or draft jobs. Close or archive jobs first.");
    }

    await HiringPartnerRepository.delete(ctx.orgId, id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "hiring_partner.deleted",
      entityType: "hiring_partner",
      entityId: id,
      oldValue: { name: existing.name },
    });
  }
}

// ─── Placement Service ────────────────────────────────────────────────────────

export class PlacementService {
  static async list(ctx: RequestContext, filters: PlacementFilters) {
    return PlacementRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const placement = await PlacementRepository.findById(ctx.orgId, id);
    if (!placement) throw new NotFoundError("Placement", id);
    return placement;
  }

  static async create(ctx: RequestContext, input: CreatePlacementInput) {
    await assertPlacementRefsInOrg(ctx.orgId, input.studentId, input.hiringPartnerId);
    const placement = await PlacementRepository.create(ctx.orgId, ctx.user.id, input);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "placement.created",
      entityType: "placement",
      entityId: placement.id,
      newValue: {
        studentId: input.studentId,
        jobTitle: input.jobTitle,
        hiringPartnerId: input.hiringPartnerId,
      },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "created",
      objectType: "placement",
      objectId: placement.id,
      objectSnapshot: { jobTitle: input.jobTitle, studentId: input.studentId },
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "placement/created",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        placementId: placement.id,
        studentId: input.studentId,
        jobTitle: input.jobTitle,
        hiringPartnerId: input.hiringPartnerId,
      },
    });

    return placement;
  }

  static async update(ctx: RequestContext, id: string, input: UpdatePlacementInput) {
    const existing = await this.getById(ctx, id);
    await assertPlacementRefsInOrg(ctx.orgId, input.studentId, input.hiringPartnerId);
    const updated = await PlacementRepository.update(ctx.orgId, id, input);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "placement.updated",
      entityType: "placement",
      entityId: id,
      oldValue: { status: existing.status, jobTitle: existing.jobTitle },
      newValue: { status: input.status ?? existing.status, jobTitle: input.jobTitle ?? existing.jobTitle },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "updated",
      objectType: "placement",
      objectId: id,
      objectSnapshot: { jobTitle: updated.jobTitle, status: updated.status },
      context: { actorName: ctx.user.name },
    });

    if (input.status && input.status !== existing.status) {
      await emitEvent({
        name: "placement/updated",
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        requestId: ctx.requestId,
        timestamp: new Date().toISOString(),
        data: { placementId: id, studentId: existing.studentId, status: input.status },
      });
    }

    return updated;
  }

  static async delete(ctx: RequestContext, id: string) {
    const existing = await this.getById(ctx, id);
    await PlacementRepository.delete(ctx.orgId, id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "placement.deleted",
      entityType: "placement",
      entityId: id,
      oldValue: { studentId: existing.studentId, jobTitle: existing.jobTitle },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "deleted",
      objectType: "placement",
      objectId: id,
      objectSnapshot: { jobTitle: existing.jobTitle, studentId: existing.studentId },
      context: { actorName: ctx.user.name },
    });
  }
}
