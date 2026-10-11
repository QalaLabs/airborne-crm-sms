import { prisma } from "@/lib/db/client";
import type { Prisma, ContentStatus } from "@prisma/client";
import type {
  CreatePageInput,
  UpdatePageInput,
  PageFilters,
  CreateSectionInput,
  UpdateSectionInput,
  CreatePageBlockInput,
  UpdatePageBlockInput,
  ReorderLayoutInput,
} from "@/lib/validations/page.schema";

// ─── Selects ─────────────────────────────────────────────────────────────────

const PAGE_LIST_SELECT = {
  id: true,
  orgId: true,
  title: true,
  slug: true,
  status: true,
  publishedAt: true,
  scheduledAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, name: true } },
} satisfies Prisma.PageSelect;

const PAGE_FULL_SELECT = {
  id: true,
  orgId: true,
  title: true,
  slug: true,
  description: true,
  status: true,
  publishedAt: true,
  scheduledAt: true,
  publishedBy: true,
  seoTitle: true,
  seoDesc: true,
  seoKeywords: true,
  ogImage: true,
  metadata: true,
  version: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, name: true } },
  publisher: { select: { id: true, name: true } },
  sections: {
    orderBy: { order: "asc" as const },
    select: {
      id: true,
      name: true,
      order: true,
      isVisible: true,
      settings: true,
      blocks: {
        orderBy: { order: "asc" as const },
        select: {
          id: true,
          blockTypeId: true,
          order: true,
          props: true,
          isVisible: true,
          blockType: { select: { id: true, type: true, name: true, schema: true } },
        },
      },
    },
  },
} satisfies Prisma.PageSelect;

const VERSION_SELECT = {
  id: true,
  orgId: true,
  pageId: true,
  version: true,
  title: true,
  status: true,
  publishedAt: true,
  notes: true,
  createdBy: true,
  createdAt: true,
  creator: { select: { id: true, name: true } },
} satisfies Prisma.PageVersionSelect;

// ─── Page Repository ──────────────────────────────────────────────────────────

export class PageRepository {
  static async findMany(orgId: string, filters: PageFilters) {
    const where: Prisma.PageWhereInput = {
      orgId,
      ...(filters.status && { status: filters.status }),
      ...(filters.search && {
        title: { contains: filters.search, mode: "insensitive" as const },
      }),
    };

    const skip = (filters.page - 1) * filters.limit;
    const [data, total] = await Promise.all([
      prisma.page.findMany({
        where,
        select: PAGE_LIST_SELECT,
        skip,
        take: filters.limit,
        orderBy: { [filters.sortBy]: filters.sortDir },
      }),
      prisma.page.count({ where }),
    ]);
    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.page.findFirst({ where: { id, orgId }, select: PAGE_FULL_SELECT });
  }

  static async findBySlug(orgId: string, slug: string) {
    return prisma.page.findFirst({ where: { slug, orgId }, select: PAGE_FULL_SELECT });
  }

  static async create(orgId: string, createdBy: string, data: CreatePageInput, slug: string) {
    return prisma.page.create({
      data: {
        orgId,
        createdBy,
        title: data.title,
        slug,
        description: data.description,
        seoTitle: data.seoTitle,
        seoDesc: data.seoDesc,
        seoKeywords: data.seoKeywords ?? [],
        ogImage: data.ogImage,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: PAGE_FULL_SELECT,
    });
  }

  static async update(orgId: string, id: string, data: UpdatePageInput) {
    return prisma.page.update({
      where: { id, orgId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.slug !== undefined && { slug: data.slug }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.seoTitle !== undefined && { seoTitle: data.seoTitle }),
        ...(data.seoDesc !== undefined && { seoDesc: data.seoDesc }),
        ...(data.seoKeywords !== undefined && { seoKeywords: data.seoKeywords }),
        ...(data.ogImage !== undefined && { ogImage: data.ogImage }),
        ...(data.metadata !== undefined && { metadata: data.metadata as Prisma.InputJsonValue }),
      },
      select: PAGE_FULL_SELECT,
    });
  }

  static async updateStatus(
    orgId: string,
    id: string,
    status: ContentStatus,
    publishedBy: string | null,
    scheduledAt?: Date | null,
  ) {
    return prisma.page.update({
      where: { id, orgId },
      data: {
        status,
        ...(publishedBy !== null && { publishedBy }),
        publishedAt: status === "PUBLISHED" ? new Date() : undefined,
        scheduledAt: status === "SCHEDULED" ? scheduledAt : null,
        version: { increment: status === "PUBLISHED" ? 1 : 0 },
      },
      select: PAGE_FULL_SELECT,
    });
  }

  static async setVersionStatus(orgId: string, id: string, version: number, status: ContentStatus) {
    return prisma.page.update({
      where: { id, orgId },
      data: { version, status },
      select: { id: true, version: true, status: true },
    });
  }

  // ─── Sections ─────────────────────────────────────────────────────────────

  static async addSection(orgId: string, pageId: string, data: CreateSectionInput) {
    const maxOrder = await prisma.pageSection.aggregate({
      where: { pageId, orgId },
      _max: { order: true },
    });
    const order = data.order ?? (maxOrder._max.order ?? -1) + 1;

    return prisma.pageSection.create({
      data: {
        orgId,
        pageId,
        name: data.name,
        order,
        isVisible: data.isVisible ?? true,
        settings: (data.settings ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  static async updateSection(orgId: string, sectionId: string, data: UpdateSectionInput) {
    return prisma.pageSection.update({
      where: { id: sectionId, orgId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.order !== undefined && { order: data.order }),
        ...(data.isVisible !== undefined && { isVisible: data.isVisible }),
        ...(data.settings !== undefined && { settings: data.settings as Prisma.InputJsonValue }),
      },
    });
  }

  static async deleteSection(orgId: string, sectionId: string) {
    return prisma.pageSection.delete({ where: { id: sectionId, orgId } });
  }

  // ─── Blocks ───────────────────────────────────────────────────────────────

  static async addBlock(orgId: string, sectionId: string, data: CreatePageBlockInput) {
    const maxOrder = await prisma.pageBlock.aggregate({
      where: { sectionId, orgId },
      _max: { order: true },
    });
    const order = data.order ?? (maxOrder._max.order ?? -1) + 1;

    return prisma.pageBlock.create({
      data: {
        orgId,
        sectionId,
        blockTypeId: data.blockTypeId,
        order,
        props: (data.props ?? {}) as Prisma.InputJsonValue,
        isVisible: data.isVisible ?? true,
      },
      select: {
        id: true,
        sectionId: true,
        blockTypeId: true,
        order: true,
        props: true,
        isVisible: true,
        blockType: { select: { id: true, type: true, name: true, schema: true } },
      },
    });
  }

  static async updateBlock(orgId: string, blockId: string, data: UpdatePageBlockInput) {
    return prisma.pageBlock.update({
      where: { id: blockId, orgId },
      data: {
        ...(data.props !== undefined && { props: data.props as Prisma.InputJsonValue }),
        ...(data.order !== undefined && { order: data.order }),
        ...(data.isVisible !== undefined && { isVisible: data.isVisible }),
      },
      select: {
        id: true,
        sectionId: true,
        blockTypeId: true,
        order: true,
        props: true,
        isVisible: true,
      },
    });
  }

  static async deleteBlock(orgId: string, blockId: string) {
    return prisma.pageBlock.delete({ where: { id: blockId, orgId } });
  }

  // ─── Layout reorder ───────────────────────────────────────────────────────

  static async reorderLayout(orgId: string, input: ReorderLayoutInput) {
    const ops: Prisma.PrismaPromise<unknown>[] = [];

    for (const s of input.sections ?? []) {
      ops.push(prisma.pageSection.update({ where: { id: s.id, orgId }, data: { order: s.order } }));
    }
    for (const [, blocks] of Object.entries(input.blocks ?? {})) {
      for (const b of blocks) {
        ops.push(prisma.pageBlock.update({ where: { id: b.id, orgId }, data: { order: b.order } }));
      }
    }

    if (ops.length > 0) await prisma.$transaction(ops);
  }

  // ─── Versions ─────────────────────────────────────────────────────────────

  static async createVersion(
    orgId: string,
    pageId: string,
    version: number,
    title: string,
    snapshot: unknown,
    status: ContentStatus,
    publishedAt: Date | null,
    createdBy: string | null,
    notes?: string,
  ) {
    return prisma.pageVersion.create({
      data: {
        orgId,
        pageId,
        version,
        title,
        snapshot: snapshot as Prisma.InputJsonValue,
        status,
        publishedAt,
        createdBy,
        notes,
      },
      select: VERSION_SELECT,
    });
  }

  static async listVersions(orgId: string, pageId: string) {
    return prisma.pageVersion.findMany({
      where: { pageId, orgId },
      select: VERSION_SELECT,
      orderBy: { version: "desc" },
    });
  }

  static async findVersion(orgId: string, pageId: string, versionId: string) {
    return prisma.pageVersion.findFirst({
      where: { id: versionId, pageId, orgId },
      select: { ...VERSION_SELECT, snapshot: true },
    });
  }

  // Atomically rebuild page structure from a snapshot (B-01 fix: interactive transaction)
  static async applySnapshot(orgId: string, pageId: string, snapshot: PageSnapshot) {
    await prisma.$transaction(
      async (tx) => {
        await tx.pageSection.deleteMany({ where: { pageId, orgId } });

        for (const sec of snapshot.sections ?? []) {
          const section = await tx.pageSection.create({
            data: {
              orgId,
              pageId,
              name: sec.name,
              order: sec.order,
              isVisible: sec.isVisible,
              settings: (sec.settings ?? {}) as Prisma.InputJsonValue,
            },
          });

          for (const blk of sec.blocks ?? []) {
            const blockType = await tx.contentBlock.findFirst({
              where: { type: blk.blockType, orgId },
              select: { id: true },
            });
            if (!blockType) continue;

            await tx.pageBlock.create({
              data: {
                orgId,
                sectionId: section.id,
                blockTypeId: blockType.id,
                order: blk.order,
                props: (blk.props ?? {}) as Prisma.InputJsonValue,
                isVisible: blk.isVisible,
              },
            });
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  static async findScheduledDue() {
    return prisma.page.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
      select: { id: true, orgId: true, slug: true, version: true, title: true },
    });
  }

  /**
   * Atomically claims a scheduled page for publication. Returns the claimed
   * record or null when another execution already published it (concurrent or
   * retried cron run). The status gate in the WHERE makes the claim idempotent.
   */
  static async claimScheduledPublish(orgId: string, id: string) {
    const claimed = await prisma.page.updateMany({
      where: { id, orgId, status: "SCHEDULED", scheduledAt: { lte: new Date() } },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        scheduledAt: null,
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) return null;
    return prisma.page.findUnique({ where: { id, orgId }, select: PAGE_FULL_SELECT });
  }
}

// ─── Snapshot Types ───────────────────────────────────────────────────────────

export interface PageSnapshot {
  title: string;
  slug: string;
  seo: { title?: string; desc?: string; keywords?: string[] };
  sections: Array<{
    name?: string;
    order: number;
    isVisible: boolean;
    settings?: Record<string, unknown>;
    blocks: Array<{
      blockType: string;
      order: number;
      props: Record<string, unknown>;
      isVisible: boolean;
    }>;
  }>;
}
