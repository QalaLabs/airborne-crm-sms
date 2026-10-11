import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type { PaginationParams } from "@/types";

interface WriteFeedParams {
  orgId: string;
  actorId?: string;
  verb: string;
  objectType: string;
  objectId: string;
  objectSnapshot: Record<string, unknown>;
  targetId?: string;
  targetType?: string;
  context?: Record<string, unknown>;
}

export class ActivityFeedService {
  static async write(params: WriteFeedParams): Promise<void> {
    try {
      await prisma.activityFeedItem.create({
        data: {
          orgId: params.orgId,
          actorId: params.actorId,
          verb: params.verb,
          objectType: params.objectType,
          objectId: params.objectId,
          objectSnapshot: params.objectSnapshot as Prisma.InputJsonValue,
          targetId: params.targetId,
          targetType: params.targetType,
          context: (params.context ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      console.error("[ActivityFeedService] write failed", err);
    }
  }

  // Get activity feed for a specific entity (e.g., lead profile timeline)
  static async getEntityFeed(
    orgId: string,
    objectType: string,
    objectId: string,
    params: PaginationParams = {},
  ) {
    const limit = params.limit ?? 20;
    const skip = ((params.page ?? 1) - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.activityFeedItem.findMany({
        where: {
          orgId,
          OR: [
            { objectType, objectId },
            { targetType: objectType, targetId: objectId },
          ],
        },
        orderBy: { occurredAt: "desc" },
        skip,
        take: limit,
        include: {
          actor: { select: { id: true, name: true, avatarUrl: true, role: true } },
        },
      }),
      prisma.activityFeedItem.count({
        where: {
          orgId,
          OR: [
            { objectType, objectId },
            { targetType: objectType, targetId: objectId },
          ],
        },
      }),
    ]);

    return { items, total };
  }

  // Get org-wide activity feed (dashboard)
  static async getOrgFeed(orgId: string, params: PaginationParams = {}) {
    const limit = params.limit ?? 30;
    const skip = ((params.page ?? 1) - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.activityFeedItem.findMany({
        where: { orgId },
        orderBy: { occurredAt: "desc" },
        skip,
        take: limit,
        include: {
          actor: { select: { id: true, name: true, avatarUrl: true, role: true } },
        },
      }),
      prisma.activityFeedItem.count({ where: { orgId } }),
    ]);

    return { items, total };
  }
}
