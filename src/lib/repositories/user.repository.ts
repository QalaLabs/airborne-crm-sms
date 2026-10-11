import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type { UserFilters } from "@/lib/validations/user.schema";
import { sha256 } from "@/lib/utils/crypto";

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  avatarUrl: true,
  campusId: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  campus: { select: { id: true, name: true, code: true } },
} satisfies Prisma.UserSelect;

export class UserRepository {
  static async findMany(orgId: string, filters: UserFilters) {
    // Include soft-deleted rows only when explicitly filtering for inactive users,
    // so deactivated accounts remain visible and can be reactivated.
    const includeDeleted = filters.isActive === false;
    const where: Prisma.UserWhereInput = {
      orgId,
      ...(includeDeleted ? {} : { deletedAt: null }),
      ...(filters.role && { role: filters.role }),
      ...(filters.campusId && { campusId: filters.campusId }),
      ...(typeof filters.isActive === "boolean" && { isActive: filters.isActive }),
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search, mode: "insensitive" } },
          { email: { contains: filters.search, mode: "insensitive" } },
        ],
      }),
    };

    const skip = (filters.page - 1) * filters.limit;
    const orderBy = { [filters.sortBy]: filters.sortDir } as Prisma.UserOrderByWithRelationInput;

    const [data, total] = await Promise.all([
      prisma.user.findMany({ where, select: USER_SELECT, skip, take: filters.limit, orderBy }),
      prisma.user.count({ where }),
    ]);

    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.user.findFirst({
      where: { id, orgId, deletedAt: null },
      select: USER_SELECT,
    });
  }

  static async findByIdIncludingDeleted(orgId: string, id: string) {
    return prisma.user.findFirst({
      where: { id, orgId },
      select: USER_SELECT,
    });
  }

  static async findByEmail(orgId: string, email: string) {
    return prisma.user.findFirst({
      where: { email: email.toLowerCase(), orgId, deletedAt: null },
    });
  }

  static async findByInviteToken(rawToken: string) {
    return prisma.user.findFirst({
      where: { inviteToken: sha256(rawToken), inviteExpiry: { gt: new Date() } },
    });
  }

  static async findByIdWithPassword(orgId: string, id: string) {
    return prisma.user.findFirst({
      where: { id, orgId, deletedAt: null },
      select: { ...USER_SELECT, passwordHash: true },
    });
  }

  static async findByEmailWithPassword(orgId: string, email: string) {
    return prisma.user.findFirst({
      where: { email: email.toLowerCase(), orgId, deletedAt: null },
      select: { ...USER_SELECT, passwordHash: true },
    });
  }

  static async countActiveSuperAdmins(orgId: string) {
    return prisma.user.count({
      where: { orgId, role: "SUPER_ADMIN", isActive: true, deletedAt: null },
    });
  }

  static async setPassword(orgId: string, id: string, passwordHash: string) {
    return prisma.user.update({
      where: { id, orgId },
      data: { passwordHash },
      select: USER_SELECT,
    });
  }

  static async create(
    orgId: string,
    data: {
      email: string;
      name: string;
      passwordHash?: string;
      role: string;
      campusId?: string;
      phone?: string;
      avatarUrl?: string;
      inviteToken?: string;
      inviteExpiry?: Date;
      isActive?: boolean;
    },
  ) {
    // (email, orgId) is unique across soft-deleted rows too, so a previously deactivated
    // account must be restored in place; old credentials and MFA are wiped.
    const deleted = await prisma.user.findFirst({
      where: { email: data.email.toLowerCase(), orgId, deletedAt: { not: null } },
      select: { id: true },
    });
    if (deleted) {
      return prisma.user.update({
        where: { id: deleted.id },
        data: {
          name: data.name,
          passwordHash: data.passwordHash ?? null,
          role: data.role as never,
          campusId: data.campusId ?? null,
          phone: data.phone ?? null,
          avatarUrl: data.avatarUrl ?? null,
          inviteToken: data.inviteToken ?? null,
          inviteExpiry: data.inviteExpiry ?? null,
          isActive: data.isActive ?? false,
          isMfaEnabled: false,
          mfaSecret: null,
          deletedAt: null,
        },
        select: USER_SELECT,
      });
    }

    return prisma.user.create({
      data: {
        orgId,
        email: data.email.toLowerCase(),
        name: data.name,
        passwordHash: data.passwordHash,
        role: data.role as never,
        campusId: data.campusId,
        phone: data.phone,
        avatarUrl: data.avatarUrl,
        inviteToken: data.inviteToken,
        inviteExpiry: data.inviteExpiry,
        isActive: data.isActive ?? false,
      },
      select: USER_SELECT,
    });
  }

  static async update(orgId: string, id: string, data: Prisma.UserUpdateInput) {
    return prisma.user.update({
      where: { id, orgId },
      data,
      select: USER_SELECT,
    });
  }

  static async softDelete(orgId: string, id: string) {
    return prisma.user.update({
      where: { id, orgId },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  static async acceptInvite(id: string, passwordHash: string) {
    return prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        isActive: true,
        inviteToken: null,
        inviteExpiry: null,
        emailVerified: new Date(),
      },
      select: USER_SELECT,
    });
  }
}
