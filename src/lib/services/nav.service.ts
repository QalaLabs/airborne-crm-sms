import { NavRepository } from "@/lib/repositories/nav.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { NotFoundError, ConflictError } from "@/lib/utils/errors";
import type { CreateNavMenuInput, UpdateNavMenuInput } from "@/lib/validations/nav.schema";
import type { RequestContext } from "@/types";

export class NavService {
  static async list(ctx: RequestContext) {
    return NavRepository.findAll(ctx.orgId);
  }

  static async getById(ctx: RequestContext, id: string) {
    const menu = await NavRepository.findById(ctx.orgId, id);
    if (!menu) throw new NotFoundError("NavMenu", id);
    return menu;
  }

  static async create(ctx: RequestContext, input: CreateNavMenuInput) {
    const existing = await NavRepository.findByLocation(ctx.orgId, input.location);
    if (existing) {
      throw new ConflictError(
        `A nav menu for location "${input.location}" already exists. Use PUT to update its items.`,
      );
    }

    const menu = await NavRepository.create(ctx.orgId, ctx.user.id, input);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "nav.created",
      entityType: "nav_menu",
      entityId: menu.id,
      newValue: { name: menu.name, location: menu.location },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "created",
      objectType: "nav_menu",
      objectId: menu.id,
      objectSnapshot: { name: menu.name, location: menu.location },
      context: { actorName: ctx.user.name },
    });

    return menu;
  }

  static async update(ctx: RequestContext, id: string, input: UpdateNavMenuInput) {
    await this.getById(ctx, id);
    const updated = await NavRepository.update(ctx.orgId, id, input);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "nav.updated",
      entityType: "nav_menu",
      entityId: id,
      newValue: { itemCount: input.items.length },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "updated",
      objectType: "nav_menu",
      objectId: id,
      objectSnapshot: { name: updated.name, location: updated.location },
      context: { actorName: ctx.user.name },
    });

    return updated;
  }

  static async delete(ctx: RequestContext, id: string) {
    await this.getById(ctx, id);
    await NavRepository.delete(ctx.orgId, id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "nav.deleted",
      entityType: "nav_menu",
      entityId: id,
    });
  }
}
