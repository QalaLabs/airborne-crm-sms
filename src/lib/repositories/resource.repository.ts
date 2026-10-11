import { prisma } from "@/lib/db/client";
import type { Prisma, ContentStatus } from "@prisma/client";
import type { CreateResourceInput, UpdateResourceInput, ResourceFilters } from "@/lib/validations/resource.schema";

const RESOURCE_SELECT = {
  id: true,
  orgId: true,
  title: true,
  slug: true,
  description: true,
  type: true,
  status: true,
  fileUrl: true,
  externalUrl: true,
  thumbnailId: true,
  tags: true,
  category: true,
  isGated: true,
  downloadCount: true,
  seoTitle: true,
  seoDesc: true,
  publishedAt: true,
  scheduledAt: true,
  metadata: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, name: true } },
} satisfies Prisma.ResourceSelect;

export class ResourceRepository {
  static async findMany(orgId: string, filters: ResourceFilters) {
    const where: Prisma.ResourceWhereInput = {
      orgId,
      ...(filters.status && { status: filters.status }),
      ...(filters.type && { type: filters.type }),
      ...(filters.category && { category: filters.category }),
      ...(filters.isGated !== undefined && { isGated: filters.isGated }),
      ...(filters.search && {
        OR: [
          { title: { contains: filters.search, mode: "insensitive" as const } },
          { description: { contains: filters.search, mode: "insensitive" as const } },
        ],
      }),
    };

    const skip = (filters.page - 1) * filters.limit;
    const [data, total] = await Promise.all([
      prisma.resource.findMany({
        where,
        select: RESOURCE_SELECT,
        skip,
        take: filters.limit,
        orderBy: { [filters.sortBy]: filters.sortDir },
      }),
      prisma.resource.count({ where }),
    ]);
    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.resource.findFirst({ where: { id, orgId }, select: RESOURCE_SELECT });
  }

  static async findBySlug(orgId: string, slug: string) {
    return prisma.resource.findFirst({ where: { slug, orgId }, select: RESOURCE_SELECT });
  }

  static async create(orgId: string, createdBy: string, data: CreateResourceInput, slug: string) {
    return prisma.resource.create({
      data: {
        orgId,
        createdBy,
        title: data.title,
        slug,
        description: data.description,
        type: data.type,
        fileUrl: data.fileUrl,
        externalUrl: data.externalUrl,
        thumbnailId: data.thumbnailId,
        tags: data.tags ?? [],
        category: data.category,
        isGated: data.isGated ?? false,
        seoTitle: data.seoTitle,
        seoDesc: data.seoDesc,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: RESOURCE_SELECT,
    });
  }

  static async update(orgId: string, id: string, data: UpdateResourceInput) {
    return prisma.resource.update({
      where: { id, orgId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.slug !== undefined && { slug: data.slug }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.fileUrl !== undefined && { fileUrl: data.fileUrl }),
        ...(data.externalUrl !== undefined && { externalUrl: data.externalUrl }),
        ...(data.thumbnailId !== undefined && { thumbnailId: data.thumbnailId }),
        ...(data.tags !== undefined && { tags: data.tags }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.isGated !== undefined && { isGated: data.isGated }),
        ...(data.seoTitle !== undefined && { seoTitle: data.seoTitle }),
        ...(data.seoDesc !== undefined && { seoDesc: data.seoDesc }),
        ...(data.metadata !== undefined && { metadata: data.metadata as Prisma.InputJsonValue }),
      },
      select: RESOURCE_SELECT,
    });
  }

  static async updateStatus(orgId: string, id: string, status: ContentStatus, scheduledAt?: Date | null) {
    return prisma.resource.update({
      where: { id, orgId },
      data: {
        status,
        publishedAt: status === "PUBLISHED" ? new Date() : undefined,
        scheduledAt: status === "SCHEDULED" ? scheduledAt : null,
      },
      select: RESOURCE_SELECT,
    });
  }

  static async incrementDownload(orgId: string, id: string) {
    return prisma.resource.update({
      where: { id, orgId },
      data: { downloadCount: { increment: 1 } },
      select: { id: true, downloadCount: true },
    });
  }

  static async delete(orgId: string, id: string) {
    return prisma.resource.delete({ where: { id, orgId } });
  }

  static async findScheduledDue() {
    return prisma.resource.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
      select: { id: true, orgId: true, slug: true, title: true, type: true },
    });
  }

  /**
   * Atomically claims a scheduled resource for publication. Returns the claimed
   * record or null when another execution already published it (concurrent or
   * retried cron run). The status gate in the WHERE makes the claim idempotent.
   */
  static async claimScheduledPublish(orgId: string, id: string) {
    const claimed = await prisma.resource.updateMany({
      where: { id, orgId, status: "SCHEDULED", scheduledAt: { lte: new Date() } },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        scheduledAt: null,
      },
    });
    if (claimed.count === 0) return null;
    return prisma.resource.findUnique({ where: { id, orgId }, select: RESOURCE_SELECT });
  }
}
