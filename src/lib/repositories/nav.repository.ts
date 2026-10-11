import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type { CreateNavMenuInput, UpdateNavMenuInput } from "@/lib/validations/nav.schema";

const NAV_SELECT = {
  id: true,
  orgId: true,
  name: true,
  location: true,
  items: true,
  isActive: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, name: true } },
} satisfies Prisma.NavMenuSelect;

export class NavRepository {
  static async findAll(orgId: string) {
    return prisma.navMenu.findMany({
      where: { orgId },
      select: NAV_SELECT,
      orderBy: { location: "asc" },
    });
  }

  static async findById(orgId: string, id: string) {
    return prisma.navMenu.findFirst({ where: { id, orgId }, select: NAV_SELECT });
  }

  static async findByLocation(orgId: string, location: string) {
    return prisma.navMenu.findFirst({ where: { location, orgId }, select: NAV_SELECT });
  }

  static async create(orgId: string, createdBy: string, data: CreateNavMenuInput) {
    return prisma.navMenu.create({
      data: {
        orgId,
        createdBy,
        name: data.name,
        location: data.location,
        items: (data.items ?? []) as unknown as Prisma.InputJsonValue,
      },
      select: NAV_SELECT,
    });
  }

  static async update(orgId: string, id: string, data: UpdateNavMenuInput) {
    return prisma.navMenu.update({
      where: { id, orgId },
      data: {
        items: data.items as unknown as Prisma.InputJsonValue,
        ...(data.name && { name: data.name }),
      },
      select: NAV_SELECT,
    });
  }

  static async delete(orgId: string, id: string) {
    return prisma.navMenu.delete({ where: { id, orgId } });
  }
}
