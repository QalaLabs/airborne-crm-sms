import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type { CreateBlockInput, UpdateBlockInput, BlockFilters } from "@/lib/validations/block.schema";

const BLOCK_SELECT = {
  id: true,
  orgId: true,
  type: true,
  name: true,
  description: true,
  schema: true,
  defaultProps: true,
  category: true,
  isGlobal: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, name: true } },
} satisfies Prisma.ContentBlockSelect;

export class BlockRepository {
  static async findMany(orgId: string, filters: BlockFilters) {
    const where: Prisma.ContentBlockWhereInput = {
      orgId,
      ...(filters.category && { category: filters.category }),
      ...(filters.isGlobal !== undefined && { isGlobal: filters.isGlobal }),
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search, mode: "insensitive" as const } },
          { type: { contains: filters.search, mode: "insensitive" as const } },
        ],
      }),
    };

    const skip = (filters.page - 1) * filters.limit;
    const [data, total] = await Promise.all([
      prisma.contentBlock.findMany({
        where,
        select: BLOCK_SELECT,
        skip,
        take: filters.limit,
        orderBy: [{ category: "asc" }, { name: "asc" }],
      }),
      prisma.contentBlock.count({ where }),
    ]);
    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.contentBlock.findFirst({ where: { id, orgId }, select: BLOCK_SELECT });
  }

  static async findByType(orgId: string, type: string) {
    return prisma.contentBlock.findFirst({ where: { type, orgId }, select: BLOCK_SELECT });
  }

  static async create(orgId: string, createdBy: string, data: CreateBlockInput) {
    return prisma.contentBlock.create({
      data: {
        orgId,
        createdBy,
        type: data.type,
        name: data.name,
        description: data.description,
        schema: data.schema as Prisma.InputJsonValue,
        defaultProps: (data.defaultProps ?? {}) as Prisma.InputJsonValue,
        category: data.category,
        isGlobal: data.isGlobal ?? false,
      },
      select: BLOCK_SELECT,
    });
  }

  static async update(orgId: string, id: string, data: UpdateBlockInput) {
    return prisma.contentBlock.update({
      where: { id, orgId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.schema !== undefined && { schema: data.schema as Prisma.InputJsonValue }),
        ...(data.defaultProps !== undefined && { defaultProps: data.defaultProps as Prisma.InputJsonValue }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.isGlobal !== undefined && { isGlobal: data.isGlobal }),
      },
      select: BLOCK_SELECT,
    });
  }

  static async delete(orgId: string, id: string) {
    return prisma.contentBlock.delete({ where: { id, orgId } });
  }

  static async getUsageCount(id: string) {
    return prisma.pageBlock.count({ where: { blockTypeId: id } });
  }
}
