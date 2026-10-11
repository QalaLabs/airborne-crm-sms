import { BlockRepository } from "@/lib/repositories/block.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { NotFoundError, ConflictError } from "@/lib/utils/errors";
import type { CreateBlockInput, UpdateBlockInput, BlockFilters } from "@/lib/validations/block.schema";
import type { RequestContext } from "@/types";

export class BlockService {
  static async list(ctx: RequestContext, filters: BlockFilters) {
    return BlockRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const block = await BlockRepository.findById(ctx.orgId, id);
    if (!block) throw new NotFoundError("ContentBlock", id);
    return block;
  }

  static async create(ctx: RequestContext, input: CreateBlockInput) {
    // Enforce unique type per org
    const existing = await BlockRepository.findByType(ctx.orgId, input.type);
    if (existing) {
      throw new ConflictError(`A block type "${input.type}" already exists in this organization.`);
    }

    const block = await BlockRepository.create(ctx.orgId, ctx.user.id, input);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "block.created",
      entityType: "content_block",
      entityId: block.id,
      newValue: { type: block.type, name: block.name },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "created",
      objectType: "content_block",
      objectId: block.id,
      objectSnapshot: { type: block.type, name: block.name },
      context: { actorName: ctx.user.name },
    });

    return block;
  }

  static async update(ctx: RequestContext, id: string, input: UpdateBlockInput) {
    const existing = await this.getById(ctx, id);
    const updated = await BlockRepository.update(ctx.orgId, id, input);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "block.updated",
      entityType: "content_block",
      entityId: id,
      oldValue: { name: existing.name, category: existing.category },
      newValue: { name: input.name ?? existing.name, category: input.category ?? existing.category },
    });

    return updated;
  }

  static async delete(ctx: RequestContext, id: string) {
    await this.getById(ctx, id);

    const usageCount = await BlockRepository.getUsageCount(id);
    if (usageCount > 0) {
      throw new ConflictError(
        `Cannot delete block type - it is placed on ${usageCount} page(s). Remove all instances first.`,
      );
    }

    await BlockRepository.delete(ctx.orgId, id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "block.deleted",
      entityType: "content_block",
      entityId: id,
    });
  }
}
