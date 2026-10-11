import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type { CreateFeePlanInput, UpdateFeePlanInput, FeePlanFilters } from "@/lib/validations/fee-plan.schema";

const FEE_PLAN_SELECT = {
  id: true,
  orgId: true,
  courseId: true,
  course: { select: { id: true, title: true, slug: true, fee: true } },
  name: true,
  description: true,
  currency: true,
  isActive: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      id: true,
      name: true,
      amount: true,
      percentOfFee: true,
      dueOffsetDays: true,
      sortOrder: true,
      metadata: true,
    },
  },
  _count: { select: { admissions: true } },
} satisfies Prisma.FeePlanSelect;

export class FeePlanRepository {
  static async findMany(orgId: string, filters: FeePlanFilters) {
    const where: Prisma.FeePlanWhereInput = {
      orgId,
      ...(filters.courseId && { courseId: filters.courseId }),
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search, mode: "insensitive" } },
          { description: { contains: filters.search, mode: "insensitive" } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      prisma.feePlan.findMany({
        where,
        select: FEE_PLAN_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.feePlan.count({ where }),
    ]);

    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.feePlan.findFirst({
      where: { id, orgId },
      select: FEE_PLAN_SELECT,
    });
  }

  static async create(orgId: string, input: CreateFeePlanInput) {
    return prisma.feePlan.create({
      data: {
        orgId,
        courseId: input.courseId ?? null,
        name: input.name,
        description: input.description,
        currency: input.currency,
        isActive: input.isActive,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        items: {
          create: input.items.map((item, idx) => ({
            name: item.name,
            amount: item.amount ?? 0,
            percentOfFee: item.percentOfFee,
            dueOffsetDays: item.dueOffsetDays,
            sortOrder: item.sortOrder ?? idx,
            metadata: (item.metadata ?? {}) as Prisma.InputJsonValue,
          })),
        },
      },
      select: FEE_PLAN_SELECT,
    });
  }

  static async update(orgId: string, id: string, input: UpdateFeePlanInput) {
    const existing = await prisma.feePlan.findFirst({ where: { id, orgId }, select: { id: true } });
    if (!existing) return null;

    return prisma.$transaction(async (tx) => {
      if (input.items) {
        await tx.feePlanItem.deleteMany({ where: { feePlanId: id } });
        await tx.feePlanItem.createMany({
          data: input.items.map((item, idx) => ({
            feePlanId: id,
            name: item.name,
            amount: item.amount ?? 0,
            percentOfFee: item.percentOfFee,
            dueOffsetDays: item.dueOffsetDays,
            sortOrder: item.sortOrder ?? idx,
            metadata: (item.metadata ?? {}) as Prisma.InputJsonValue,
          })),
        });
      }

      return tx.feePlan.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.courseId !== undefined && { courseId: input.courseId }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.currency !== undefined && { currency: input.currency }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
          ...(input.metadata !== undefined && { metadata: input.metadata as Prisma.InputJsonValue }),
        },
        select: FEE_PLAN_SELECT,
      });
    });
  }
}
