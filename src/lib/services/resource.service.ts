import { ResourceRepository } from "@/lib/repositories/resource.repository";
import { MediaRepository } from "@/lib/repositories/media.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { emitEvent } from "@/lib/events/inngest";
import { NotFoundError, ConflictError, ValidationError } from "@/lib/utils/errors";
import { CONTENT_STATUS_TRANSITIONS } from "@/lib/validations/page.schema";
import type {
  CreateResourceInput,
  UpdateResourceInput,
  PublishResourceInput,
  ResourceFilters,
} from "@/lib/validations/resource.schema";
import type { ContentStatus } from "@prisma/client";
import type { RequestContext } from "@/types";
import { prisma } from "@/lib/db/client";

function generateSlug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/[\s]+/g, "-");
}

async function ensureUniqueSlug(orgId: string, base: string, excludeId?: string): Promise<string> {
  let slug = base;
  let n = 1;
  for (;;) {
    const existing = await prisma.resource.findFirst({ where: { orgId, slug }, select: { id: true } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${++n}`;
  }
}

export class ResourceService {
  static async list(ctx: RequestContext, filters: ResourceFilters) {
    return ResourceRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const resource = await ResourceRepository.findById(ctx.orgId, id);
    if (!resource) throw new NotFoundError("Resource", id);
    return resource;
  }

  static async create(ctx: RequestContext, input: CreateResourceInput) {
    const baseSlug = input.slug ?? generateSlug(input.title);
    const slug = await ensureUniqueSlug(ctx.orgId, baseSlug);

    const resource = await ResourceRepository.create(ctx.orgId, ctx.user.id, input, slug);

    // Phase 5: track MediaUsage for the thumbnail asset so referenced media can't be deleted
    if (input.thumbnailId) {
      await MediaRepository.trackUsage(ctx.orgId, input.thumbnailId, "resource", resource.id, "thumbnailId");
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "resource.created",
      entityType: "resource",
      entityId: resource.id,
      newValue: { title: resource.title, slug: resource.slug, type: resource.type },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "created",
      objectType: "resource",
      objectId: resource.id,
      objectSnapshot: { title: resource.title, type: resource.type },
      context: { actorName: ctx.user.name },
    });

    return resource;
  }

  static async update(ctx: RequestContext, id: string, input: UpdateResourceInput) {
    const existing = await this.getById(ctx, id);

    if (input.slug && input.slug !== existing.slug) {
      const conflict = await prisma.resource.findFirst({
        where: { orgId: ctx.orgId, slug: input.slug },
        select: { id: true },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictError(`Slug "${input.slug}" already in use.`);
      }
    }

    const updated = await ResourceRepository.update(ctx.orgId, id, input);

    // Phase 5: reconcile thumbnail MediaUsage on change
    if (input.thumbnailId !== undefined && input.thumbnailId !== existing.thumbnailId) {
      if (existing.thumbnailId) {
        await MediaRepository.untrackUsage(existing.thumbnailId, "resource", id, "thumbnailId");
      }
      if (input.thumbnailId) {
        await MediaRepository.trackUsage(ctx.orgId, input.thumbnailId, "resource", id, "thumbnailId");
      }
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "resource.updated",
      entityType: "resource",
      entityId: id,
      oldValue: { title: existing.title },
      newValue: { title: input.title ?? existing.title },
    });

    return updated;
  }

  static async publish(ctx: RequestContext, id: string, input: PublishResourceInput) {
    const existing = await this.getById(ctx, id);
    const fromStatus = existing.status as ContentStatus;
    const toStatus = input.status as ContentStatus;

    const allowed = CONTENT_STATUS_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new ValidationError([
        { message: `Cannot transition from ${fromStatus} to ${toStatus}. Allowed: ${allowed.join(", ")}` },
      ]);
    }

    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    const resource = await ResourceRepository.updateStatus(ctx.orgId, id, toStatus, scheduledAt);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: `resource.${toStatus.toLowerCase()}`,
      entityType: "resource",
      entityId: id,
      oldValue: { status: fromStatus },
      newValue: { status: toStatus },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: toStatus === "PUBLISHED" ? "published" : toStatus.toLowerCase(),
      objectType: "resource",
      objectId: id,
      objectSnapshot: { title: resource.title, status: toStatus },
      context: { actorName: ctx.user.name },
    });

    if (toStatus === "PUBLISHED") {
      await emitEvent({
        name: "resource/published",
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        requestId: ctx.requestId,
        timestamp: new Date().toISOString(),
        data: { resourceId: id, slug: resource.slug, title: resource.title, type: resource.type },
      });
    }

    await emitEvent({
      name: "resource/status.changed",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: { resourceId: id, slug: resource.slug, fromStatus, toStatus },
    });

    return resource;
  }

  static async delete(ctx: RequestContext, id: string) {
    const existing = await this.getById(ctx, id);
    await ResourceRepository.delete(ctx.orgId, id);

    // Phase 5: release thumbnail MediaUsage so the asset can be deleted
    if (existing.thumbnailId) {
      await MediaRepository.untrackUsage(existing.thumbnailId, "resource", id, "thumbnailId");
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "resource.deleted",
      entityType: "resource",
      entityId: id,
      oldValue: { title: existing.title, status: existing.status },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "deleted",
      objectType: "resource",
      objectId: id,
      objectSnapshot: { title: existing.title },
      context: { actorName: ctx.user.name },
    });
  }

  static async incrementDownload(ctx: RequestContext, id: string) {
    await this.getById(ctx, id);
    return ResourceRepository.incrementDownload(ctx.orgId, id);
  }

  // Cron: publish scheduled resources
  static async publishScheduledResources() {
    const due = await ResourceRepository.findScheduledDue();
    for (const r of due) {
      const updated = await ResourceRepository.claimScheduledPublish(r.orgId, r.id);
      if (!updated) continue; // already claimed by a concurrent/retried execution
      await emitEvent({
        name: "resource/published",
        orgId: r.orgId,
        actorId: "system",
        actorName: "System (Scheduled)",
        requestId: `cron-resource-${r.id}`,
        timestamp: new Date().toISOString(),
        data: { resourceId: r.id, slug: r.slug, title: r.title, type: r.type },
      });

      // Sync audit + activity parity with manual publish — null actor (scheduled/system action)
      await AuditService.write({
        orgId: r.orgId,
        action: "resource.published",
        entityType: "resource",
        entityId: r.id,
        newValue: {
          status: "PUBLISHED",
          publishedAt: updated.publishedAt?.toISOString(),
        },
      });

      await ActivityFeedService.write({
        orgId: r.orgId,
        verb: "published",
        objectType: "resource",
        objectId: r.id,
        objectSnapshot: { title: updated.title, status: "PUBLISHED" },
        context: { actorName: "System (Scheduled)" },
      });

      await emitEvent({
        name: "resource/status.changed",
        orgId: r.orgId,
        actorId: "system",
        actorName: "System (Scheduled)",
        requestId: `cron-resource-${r.id}`,
        timestamp: new Date().toISOString(),
        data: { resourceId: r.id, slug: r.slug, fromStatus: "SCHEDULED", toStatus: "PUBLISHED" },
      });
    }
    return due.length;
  }
}
