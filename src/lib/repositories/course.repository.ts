import { prisma } from "@/lib/db/client";
import type { Prisma, ContentStatus } from "@prisma/client";
import type { CreateCourseInput, UpdateCourseInput, CourseFilters } from "@/lib/validations/course.schema";

const COURSE_SELECT = {
  id: true,
  orgId: true,
  slug: true,
  title: true,
  subtitle: true,
  description: true,
  status: true,
  category: true,
  duration: true,
  eligibility: true,
  curriculum: true,
  fee: true,
  bannerImageId: true,
  galleryIds: true,
  seoTitle: true,
  seoDesc: true,
  seoKeywords: true,
  order: true,
  isFeatured: true,
  publishedAt: true,
  scheduledAt: true,
  publishedBy: true,
  version: true,
  metadata: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, name: true } },
  publisher: { select: { id: true, name: true } },
} satisfies Prisma.CourseSelect;

const VERSION_SELECT = {
  id: true,
  orgId: true,
  courseId: true,
  version: true,
  status: true,
  notes: true,
  createdBy: true,
  createdAt: true,
  creator: { select: { id: true, name: true } },
} satisfies Prisma.CourseVersionSelect;

export class CourseRepository {
  static async findMany(orgId: string, filters: CourseFilters) {
    const where: Prisma.CourseWhereInput = {
      orgId,
      ...(filters.status && { status: filters.status }),
      ...(filters.category && { category: filters.category }),
      ...(filters.isFeatured !== undefined && { isFeatured: filters.isFeatured }),
      ...(filters.search && {
        OR: [
          { title: { contains: filters.search, mode: "insensitive" as const } },
          { description: { contains: filters.search, mode: "insensitive" as const } },
        ],
      }),
    };

    const skip = (filters.page - 1) * filters.limit;
    const [data, total] = await Promise.all([
      prisma.course.findMany({
        where,
        select: COURSE_SELECT,
        skip,
        take: filters.limit,
        orderBy: { [filters.sortBy]: filters.sortDir },
      }),
      prisma.course.count({ where }),
    ]);
    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.course.findFirst({ where: { id, orgId }, select: COURSE_SELECT });
  }

  static async findBySlug(orgId: string, slug: string) {
    return prisma.course.findFirst({ where: { slug, orgId }, select: COURSE_SELECT });
  }

  static async create(orgId: string, createdBy: string, data: CreateCourseInput, slug: string) {
    return prisma.course.create({
      data: {
        orgId,
        createdBy,
        slug,
        title: data.title,
        subtitle: data.subtitle,
        description: data.description,
        category: data.category,
        duration: data.duration,
        eligibility: data.eligibility,
        curriculum: (data.curriculum ?? []) as Prisma.InputJsonValue,
        fee: data.fee,
        bannerImageId: data.bannerImageId,
        galleryIds: data.galleryIds ?? [],
        seoTitle: data.seoTitle,
        seoDesc: data.seoDesc,
        seoKeywords: data.seoKeywords ?? [],
        order: data.order ?? 0,
        isFeatured: data.isFeatured ?? false,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
        status: data.status ?? "DRAFT",
        publishedAt: data.status === "PUBLISHED" ? new Date() : null,
        scheduledAt: data.status === "SCHEDULED" ? (data.scheduledAt ? new Date(data.scheduledAt) : null) : null,
      },
      select: COURSE_SELECT,
    });
  }

  static async update(orgId: string, id: string, data: UpdateCourseInput) {
    return prisma.course.update({
      where: { id, orgId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.slug !== undefined && { slug: data.slug }),
        ...(data.subtitle !== undefined && { subtitle: data.subtitle }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.duration !== undefined && { duration: data.duration }),
        ...(data.eligibility !== undefined && { eligibility: data.eligibility }),
        ...(data.curriculum !== undefined && { curriculum: data.curriculum as Prisma.InputJsonValue }),
        ...(data.fee !== undefined && { fee: data.fee }),
        ...(data.bannerImageId !== undefined && { bannerImageId: data.bannerImageId }),
        ...(data.galleryIds !== undefined && { galleryIds: data.galleryIds }),
        ...(data.seoTitle !== undefined && { seoTitle: data.seoTitle }),
        ...(data.seoDesc !== undefined && { seoDesc: data.seoDesc }),
        ...(data.seoKeywords !== undefined && { seoKeywords: data.seoKeywords }),
        ...(data.order !== undefined && { order: data.order }),
        ...(data.isFeatured !== undefined && { isFeatured: data.isFeatured }),
        ...(data.metadata !== undefined && { metadata: data.metadata as Prisma.InputJsonValue }),
      },
      select: COURSE_SELECT,
    });
  }

  static async updateStatus(
    orgId: string,
    id: string,
    status: ContentStatus,
    publishedBy: string | null,
    scheduledAt?: Date | null,
  ) {
    return prisma.course.update({
      where: { id, orgId },
      data: {
        status,
        ...(publishedBy !== null && { publishedBy }),
        publishedAt: status === "PUBLISHED" ? new Date() : undefined,
        scheduledAt: status === "SCHEDULED" ? scheduledAt : null,
        version: { increment: status === "PUBLISHED" ? 1 : 0 },
      },
      select: COURSE_SELECT,
    });
  }

  static async setVersionStatus(orgId: string, id: string, version: number, status: ContentStatus) {
    return prisma.course.update({
      where: { id, orgId },
      data: { version, status },
      select: { id: true, version: true, status: true },
    });
  }

  // ─── Versions ─────────────────────────────────────────────────────────────

  static async createVersion(
    orgId: string,
    courseId: string,
    version: number,
    snapshot: unknown,
    status: ContentStatus,
    createdBy: string | null,
    notes?: string,
  ) {
    return prisma.courseVersion.create({
      data: {
        orgId,
        courseId,
        version,
        snapshot: snapshot as Prisma.InputJsonValue,
        status,
        createdBy,
        notes,
      },
      select: VERSION_SELECT,
    });
  }

  static async listVersions(orgId: string, courseId: string) {
    return prisma.courseVersion.findMany({
      where: { courseId, orgId },
      select: VERSION_SELECT,
      orderBy: { version: "desc" },
    });
  }

  static async findVersion(orgId: string, courseId: string, versionId: string) {
    return prisma.courseVersion.findFirst({
      where: { id: versionId, courseId, orgId },
      select: { ...VERSION_SELECT, snapshot: true },
    });
  }

  static async findScheduledDue() {
    return prisma.course.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
      select: { id: true, orgId: true, slug: true, title: true, version: true, scheduledAt: true },
    });
  }

  /**
   * Atomically claims a scheduled course for publication. Returns the claimed
   * record or null when another execution already published it (concurrent or
   * retried cron run). The status gate in the WHERE makes the claim idempotent.
   */
  static async claimScheduledPublish(orgId: string, id: string) {
    const claimed = await prisma.course.updateMany({
      where: { id, orgId, status: "SCHEDULED", scheduledAt: { lte: new Date() } },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        scheduledAt: null,
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) return null;
    return prisma.course.findUnique({ where: { id, orgId }, select: COURSE_SELECT });
  }
}
