import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type {
  CreateHiringPartnerInput,
  UpdateHiringPartnerInput,
  HiringPartnerFilters,
  CreatePlacementInput,
  UpdatePlacementInput,
  PlacementFilters,
} from "@/lib/validations/placement.schema";

const HIRING_PARTNER_SELECT = {
  id: true,
  orgId: true,
  name: true,
  slug: true,
  logoId: true,
  website: true,
  industry: true,
  description: true,
  isActive: true,
  order: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, name: true } },
  _count: { select: { jobs: true, placements: true } },
} satisfies Prisma.HiringPartnerSelect;

const PLACEMENT_SELECT = {
  id: true,
  orgId: true,
  studentId: true,
  hiringPartnerId: true,
  jobTitle: true,
  package: true,
  currency: true,
  joiningDate: true,
  status: true,
  isPublic: true,
  batchYear: true,
  notes: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  student: { select: { id: true, firstName: true, lastName: true, studentCode: true, email: true } },
  hiringPartner: { select: { id: true, name: true, logoId: true } },
  creator: { select: { id: true, name: true } },
} satisfies Prisma.PlacementSelect;

// ─── Hiring Partner Repository ───────────────────────────────────────────────

export class HiringPartnerRepository {
  static async findMany(orgId: string, filters: HiringPartnerFilters) {
    const where: Prisma.HiringPartnerWhereInput = {
      orgId,
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      ...(filters.industry && { industry: filters.industry }),
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search, mode: "insensitive" as const } },
          { description: { contains: filters.search, mode: "insensitive" as const } },
        ],
      }),
    };

    const skip = (filters.page - 1) * filters.limit;
    const [data, total] = await Promise.all([
      prisma.hiringPartner.findMany({
        where,
        select: HIRING_PARTNER_SELECT,
        skip,
        take: filters.limit,
        orderBy: { [filters.sortBy]: filters.sortDir },
      }),
      prisma.hiringPartner.count({ where }),
    ]);
    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.hiringPartner.findFirst({ where: { id, orgId }, select: HIRING_PARTNER_SELECT });
  }

  static async findBySlug(orgId: string, slug: string) {
    return prisma.hiringPartner.findFirst({ where: { slug, orgId }, select: HIRING_PARTNER_SELECT });
  }

  static async create(orgId: string, createdBy: string, data: CreateHiringPartnerInput, slug: string) {
    return prisma.hiringPartner.create({
      data: {
        orgId,
        createdBy,
        slug,
        name: data.name,
        logoId: data.logoId,
        website: data.website,
        industry: data.industry,
        description: data.description,
        isActive: data.isActive ?? true,
        order: data.order ?? 0,
      },
      select: HIRING_PARTNER_SELECT,
    });
  }

  static async update(orgId: string, id: string, data: UpdateHiringPartnerInput) {
    return prisma.hiringPartner.update({
      where: { id, orgId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.slug !== undefined && { slug: data.slug }),
        ...(data.logoId !== undefined && { logoId: data.logoId }),
        ...(data.website !== undefined && { website: data.website }),
        ...(data.industry !== undefined && { industry: data.industry }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.order !== undefined && { order: data.order }),
      },
      select: HIRING_PARTNER_SELECT,
    });
  }

  static async delete(orgId: string, id: string) {
    return prisma.hiringPartner.delete({ where: { id, orgId } });
  }

  static async hasActiveJobs(orgId: string, id: string) {
    const count = await prisma.job.count({
      where: { hiringPartnerId: id, orgId, status: { in: ["DRAFT", "PUBLISHED"] } },
    });
    return count > 0;
  }
}

// ─── Placement Repository ─────────────────────────────────────────────────────

export class PlacementRepository {
  static async findMany(orgId: string, filters: PlacementFilters) {
    const where: Prisma.PlacementWhereInput = {
      orgId,
      ...(filters.studentId && { studentId: filters.studentId }),
      ...(filters.hiringPartnerId && { hiringPartnerId: filters.hiringPartnerId }),
      ...(filters.status && { status: filters.status }),
      ...(filters.batchYear !== undefined && { batchYear: filters.batchYear }),
      ...(filters.isPublic !== undefined && { isPublic: filters.isPublic }),
      ...(filters.search && {
        OR: [
          { jobTitle: { contains: filters.search, mode: "insensitive" as const } },
          { student: { firstName: { contains: filters.search, mode: "insensitive" as const } } },
          { student: { lastName: { contains: filters.search, mode: "insensitive" as const } } },
        ],
      }),
    };

    const skip = (filters.page - 1) * filters.limit;
    const [data, total] = await Promise.all([
      prisma.placement.findMany({
        where,
        select: PLACEMENT_SELECT,
        skip,
        take: filters.limit,
        orderBy: { [filters.sortBy]: filters.sortDir },
      }),
      prisma.placement.count({ where }),
    ]);
    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.placement.findFirst({ where: { id, orgId }, select: PLACEMENT_SELECT });
  }

  static async create(orgId: string, createdBy: string, data: CreatePlacementInput) {
    return prisma.placement.create({
      data: {
        orgId,
        createdBy,
        studentId: data.studentId,
        hiringPartnerId: data.hiringPartnerId,
        jobTitle: data.jobTitle,
        package: data.package,
        currency: data.currency ?? "INR",
        joiningDate: data.joiningDate ? new Date(data.joiningDate) : undefined,
        status: data.status ?? "PENDING",
        isPublic: data.isPublic ?? false,
        batchYear: data.batchYear,
        notes: data.notes,
      },
      select: PLACEMENT_SELECT,
    });
  }

  static async update(orgId: string, id: string, data: UpdatePlacementInput) {
    return prisma.placement.update({
      where: { id, orgId },
      data: {
        ...(data.studentId !== undefined && { studentId: data.studentId }),
        ...(data.hiringPartnerId !== undefined && { hiringPartnerId: data.hiringPartnerId }),
        ...(data.jobTitle !== undefined && { jobTitle: data.jobTitle }),
        ...(data.package !== undefined && { package: data.package }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.joiningDate !== undefined && { joiningDate: data.joiningDate ? new Date(data.joiningDate) : null }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.isPublic !== undefined && { isPublic: data.isPublic }),
        ...(data.batchYear !== undefined && { batchYear: data.batchYear }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
      select: PLACEMENT_SELECT,
    });
  }

  static async delete(orgId: string, id: string) {
    return prisma.placement.delete({ where: { id, orgId } });
  }
}
