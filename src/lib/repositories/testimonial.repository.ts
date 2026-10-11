import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type {
  CreateTestimonialInput,
  UpdateTestimonialInput,
  TestimonialFilters,
} from "@/lib/validations/testimonial.schema";

const TESTIMONIAL_SELECT = {
  id: true,
  orgId: true,
  studentId: true,
  authorName: true,
  authorTitle: true,
  authorEmail: true,
  content: true,
  rating: true,
  avatarId: true,
  courseId: true,
  batchYear: true,
  status: true,
  isFeatured: true,
  order: true,
  reviewedBy: true,
  reviewedAt: true,
  reviewNotes: true,
  source: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  student: { select: { id: true, firstName: true, lastName: true, studentCode: true } },
  reviewer: { select: { id: true, name: true } },
} satisfies Prisma.TestimonialSelect;

export class TestimonialRepository {
  static async findMany(orgId: string, filters: TestimonialFilters) {
    const where: Prisma.TestimonialWhereInput = {
      orgId,
      ...(filters.status && { status: filters.status }),
      ...(filters.courseId && { courseId: filters.courseId }),
      ...(filters.studentId && { studentId: filters.studentId }),
      ...(filters.isFeatured !== undefined && { isFeatured: filters.isFeatured }),
      ...(filters.batchYear !== undefined && { batchYear: filters.batchYear }),
      ...(filters.search && {
        OR: [
          { authorName: { contains: filters.search, mode: "insensitive" as const } },
          { content: { contains: filters.search, mode: "insensitive" as const } },
        ],
      }),
    };

    const skip = (filters.page - 1) * filters.limit;
    const [data, total] = await Promise.all([
      prisma.testimonial.findMany({
        where,
        select: TESTIMONIAL_SELECT,
        skip,
        take: filters.limit,
        orderBy: { [filters.sortBy]: filters.sortDir },
      }),
      prisma.testimonial.count({ where }),
    ]);
    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.testimonial.findFirst({ where: { id, orgId }, select: TESTIMONIAL_SELECT });
  }

  static async create(orgId: string, data: CreateTestimonialInput) {
    return prisma.testimonial.create({
      data: {
        orgId,
        studentId: data.studentId,
        authorName: data.authorName,
        authorTitle: data.authorTitle,
        authorEmail: data.authorEmail,
        content: data.content,
        rating: data.rating,
        avatarId: data.avatarId,
        courseId: data.courseId,
        batchYear: data.batchYear,
        source: data.source,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: TESTIMONIAL_SELECT,
    });
  }

  static async update(orgId: string, id: string, data: UpdateTestimonialInput) {
    return prisma.testimonial.update({
      where: { id, orgId },
      data: {
        ...(data.authorName !== undefined && { authorName: data.authorName }),
        ...(data.authorTitle !== undefined && { authorTitle: data.authorTitle }),
        ...(data.authorEmail !== undefined && { authorEmail: data.authorEmail }),
        ...(data.content !== undefined && { content: data.content }),
        ...(data.rating !== undefined && { rating: data.rating }),
        ...(data.avatarId !== undefined && { avatarId: data.avatarId }),
        ...(data.courseId !== undefined && { courseId: data.courseId }),
        ...(data.batchYear !== undefined && { batchYear: data.batchYear }),
        ...(data.isFeatured !== undefined && { isFeatured: data.isFeatured }),
        ...(data.order !== undefined && { order: data.order }),
        ...(data.source !== undefined && { source: data.source }),
        ...(data.metadata !== undefined && { metadata: data.metadata as Prisma.InputJsonValue }),
      },
      select: TESTIMONIAL_SELECT,
    });
  }

  static async review(
    orgId: string,
    id: string,
    status: "APPROVED" | "REJECTED",
    reviewedBy: string,
    reviewNotes?: string,
  ) {
    return prisma.testimonial.update({
      where: { id, orgId },
      data: {
        status,
        reviewedBy,
        reviewedAt: new Date(),
        ...(reviewNotes !== undefined && { reviewNotes }),
      },
      select: TESTIMONIAL_SELECT,
    });
  }

  static async delete(orgId: string, id: string) {
    return prisma.testimonial.delete({ where: { id, orgId } });
  }

  static async findPendingCount(orgId: string) {
    return prisma.testimonial.count({ where: { orgId, status: "PENDING" } });
  }
}
