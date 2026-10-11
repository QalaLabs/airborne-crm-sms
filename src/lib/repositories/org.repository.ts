import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type { CreateOrgInput, UpdateOrgInput, CreateCampusInput, UpdateCampusInput } from "@/lib/validations/org.schema";

// ─── Organizations ────────────────────────────────────────────────────────────

export class OrgRepository {
  static async findById(id: string) {
    return prisma.organization.findUnique({
      where: { id },
      include: { campuses: { where: { isActive: true }, select: { id: true, name: true, code: true } } },
    });
  }

  static async findBySlug(slug: string) {
    return prisma.organization.findUnique({ where: { slug } });
  }

  static async create(data: CreateOrgInput & { createdBy: string }) {
    return prisma.organization.create({
      data: {
        name: data.name,
        slug: data.slug,
        domain: data.domain,
        logoUrl: data.logoUrl,
        plan: data.plan as never,
        parentOrgId: data.parentOrgId,
        settings: {},
        featureFlags: {},
      },
    });
  }

  static async update(id: string, data: UpdateOrgInput) {
    return prisma.organization.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.domain !== undefined && { domain: data.domain }),
        ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
        ...(data.settings && { settings: data.settings as Prisma.InputJsonValue }),
        ...(data.featureFlags && { featureFlags: data.featureFlags as Prisma.InputJsonValue }),
      },
    });
  }

  static async listAll() {
    return prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { users: true, campuses: true } } },
    });
  }
}

// ─── Campuses ─────────────────────────────────────────────────────────────────

export class CampusRepository {
  static async findMany(orgId: string, includeInactive = false) {
    return prisma.campus.findMany({
      where: { orgId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { name: "asc" },
      include: {
        headCounselor: { select: { id: true, name: true, email: true } },
        _count: { select: { users: true } },
      },
    });
  }

  static async findById(orgId: string, id: string) {
    return prisma.campus.findFirst({
      where: { id, orgId },
      include: {
        headCounselor: { select: { id: true, name: true, email: true } },
        _count: { select: { users: true, leads: true } },
      },
    });
  }

  static async findByCode(orgId: string, code: string) {
    return prisma.campus.findFirst({ where: { code: code.toUpperCase(), orgId } });
  }

  static async create(orgId: string, data: CreateCampusInput) {
    return prisma.campus.create({
      data: {
        orgId,
        name: data.name,
        code: data.code.toUpperCase(),
        address: data.address,
        city: data.city,
        state: data.state,
        country: data.country,
        phone: data.phone,
        email: data.email,
        headCounselorId: data.headCounselorId,
        timezone: data.timezone,
        isActive: data.isActive ?? true,
      },
    });
  }

  static async update(orgId: string, id: string, data: UpdateCampusInput) {
    return prisma.campus.update({
      where: { id, orgId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.code && { code: data.code.toUpperCase() }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.city && { city: data.city }),
        ...(data.state && { state: data.state }),
        ...(data.country && { country: data.country }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.headCounselorId !== undefined && { headCounselorId: data.headCounselorId }),
        ...(data.timezone && { timezone: data.timezone }),
        ...(typeof data.isActive === "boolean" && { isActive: data.isActive }),
      },
    });
  }

  static async delete(orgId: string, id: string) {
    return prisma.campus.delete({ where: { id, orgId } });
  }
}
