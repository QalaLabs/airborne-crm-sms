import { prisma } from "@/lib/db/client";
import type { DealFilters, CreateDealInput, UpdateDealInput } from "@/lib/validations/deal.schema";
import type { Prisma } from "@prisma/client";
import type { AdmissionStage, LeadSource } from "@prisma/client";

const DEAL_SELECT = {
  id: true,
  orgId: true,
  leadId: true,
  admissionId: true,
  title: true,
  stage: true,
  value: true,
  currency: true,
  expectedCloseAt: true,
  source: true,
  assignedTo: true,
  createdBy: true,
  notes: true,
  lostReason: true,
  wonAt: true,
  lostAt: true,
  convertedAt: true,
  revertedAt: true,
  isActive: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  lead: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      status: true,
      score: true,
      assignedTo: true,
      campusId: true,
      courseInterest: true,
    },
  },
  admission: {
    select: {
      id: true,
      applicationNo: true,
      stage: true,
      courseName: true,
      feeAmount: true,
      feePaid: true,
      feeBalance: true,
    },
  },
  counselor: {
    select: { id: true, name: true, avatarUrl: true, email: true },
  },
  creator: {
    select: { id: true, name: true, avatarUrl: true },
  },
} satisfies Prisma.DealSelect;

export class DealRepository {
  static async findMany(orgId: string, filters: DealFilters) {
    const where: Prisma.DealWhereInput = {
      orgId,
      deletedAt: null,
      lead: { deletedAt: null },
    };

    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    if (filters.assignedTo) where.assignedTo = filters.assignedTo;
    if (filters.stage) where.stage = filters.stage;

    if (filters.status === "open") where.isActive = true;
    if (filters.status === "won") where.wonAt = { not: null };
    if (filters.status === "lost") where.lostAt = { not: null };

    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: "insensitive" } },
        { lead: { name: { contains: filters.search, mode: "insensitive" } } },
        { lead: { phone: { contains: filters.search } } },
        { lead: { email: { contains: filters.search, mode: "insensitive" } } },
      ];
    }

    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {
        ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
      };
    }

    const skip = (filters.page - 1) * filters.limit;

    const [data, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        select: DEAL_SELECT,
        orderBy: { [filters.sortBy]: filters.sortDir },
        skip,
        take: filters.limit,
      }),
      prisma.deal.count({ where }),
    ]);

    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.deal.findFirst({
      where: { id, orgId, deletedAt: null },
      select: DEAL_SELECT,
    });
  }

  static async findByLeadId(orgId: string, leadId: string) {
    return prisma.deal.findFirst({
      where: { leadId, orgId, deletedAt: null },
      select: DEAL_SELECT,
    });
  }

  static async findActiveByLeadId(orgId: string, leadId: string) {
    return prisma.deal.findFirst({
      where: { leadId, orgId, isActive: true, deletedAt: null },
      select: DEAL_SELECT,
    });
  }

  static async create(orgId: string, data: CreateDealInput & { createdBy: string }) {
    const meta = {
      ...((data.metadata ?? {}) as Record<string, unknown>),
      ...(data.courseId != null && data.courseId !== "" ? { courseId: data.courseId } : {}),
      ...(data.batchId != null && data.batchId !== "" ? { batchId: data.batchId } : {}),
      ...(data.feePlanId != null && data.feePlanId !== "" ? { feePlanId: data.feePlanId } : {}),
    };
    return prisma.deal.create({
      data: {
        orgId,
        leadId: data.leadId,
        title: data.title,
        stage: data.stage,
        value: data.value,
        currency: data.currency,
        expectedCloseAt: data.expectedCloseAt ? new Date(data.expectedCloseAt) : null,
        source: data.source,
        assignedTo: data.assignedTo ?? null,
        createdBy: data.createdBy,
        notes: data.notes,
        metadata: meta as Prisma.InputJsonValue,
      },
      select: DEAL_SELECT,
    });
  }

  static async update(orgId: string, id: string, data: UpdateDealInput) {
    const existing =
      data.courseId !== undefined || data.batchId !== undefined || data.feePlanId !== undefined
        ? await prisma.deal.findFirst({ where: { id, orgId }, select: { metadata: true } })
        : null;
    const prevMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
    const nextMeta =
      data.metadata !== undefined
        ? (data.metadata as Record<string, unknown>)
        : data.courseId !== undefined || data.batchId !== undefined || data.feePlanId !== undefined
          ? {
              ...prevMeta,
              ...(data.courseId !== undefined ? { courseId: data.courseId } : {}),
              ...(data.batchId !== undefined ? { batchId: data.batchId } : {}),
              ...(data.feePlanId !== undefined ? { feePlanId: data.feePlanId } : {}),
            }
          : undefined;

    return prisma.deal.update({
      where: { id, orgId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.stage !== undefined && { stage: data.stage }),
        ...(data.value !== undefined && { value: data.value }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.expectedCloseAt !== undefined && {
          expectedCloseAt: data.expectedCloseAt ? new Date(data.expectedCloseAt) : null,
        }),
        ...(data.source !== undefined && { source: data.source }),
        ...(data.assignedTo !== undefined && { assignedTo: data.assignedTo ?? null }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.lostReason !== undefined && { lostReason: data.lostReason }),
        ...(nextMeta !== undefined && { metadata: nextMeta as Prisma.InputJsonValue }),
      } as Prisma.DealUncheckedUpdateInput,
      select: DEAL_SELECT,
    });
  }

  static async softDelete(orgId: string, id: string) {
    return prisma.deal.update({
      where: { id, orgId },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }

  static async getStageCounts(orgId: string) {
    return prisma.deal.groupBy({
      by: ["stage"],
      where: { orgId, isActive: true, deletedAt: null, lead: { deletedAt: null } },
      _count: { stage: true },
      _sum: { value: true },
    });
  }

  static async getPipelineSummary(orgId: string) {
    const openWhere = {
      orgId,
      isActive: true,
      wonAt: null,
      lostAt: null,
      deletedAt: null,
      lead: { deletedAt: null },
    } satisfies Prisma.DealWhereInput;

    const [won, lost, active, byStage] = await Promise.all([
      prisma.deal.aggregate({
        where: { orgId, wonAt: { not: null }, deletedAt: null, lead: { deletedAt: null } },
        _count: true,
        _sum: { value: true },
      }),
      prisma.deal.aggregate({
        where: { orgId, lostAt: { not: null }, deletedAt: null, lead: { deletedAt: null } },
        _count: true,
        _sum: { value: true },
      }),
      prisma.deal.aggregate({ where: openWhere, _count: true, _sum: { value: true } }),
      prisma.deal.groupBy({
        by: ["stage"],
        where: openWhere,
        _count: true,
        _sum: { value: true },
      }),
    ]);

    return {
      wonCount: won._count,
      wonValue: Number(won._sum.value ?? 0),
      lostCount: lost._count,
      lostValue: Number(lost._sum.value ?? 0),
      openCount: active._count,
      openValue: Number(active._sum.value ?? 0),
      byStage: byStage.map((s) => ({
        stage: s.stage,
        count: s._count,
        value: Number(s._sum.value ?? 0),
      })),
    };
  }

  static async assignMany(orgId: string, dealIds: string[], assignedTo: string | null) {
    return prisma.deal.updateMany({
      where: { id: { in: dealIds }, orgId, deletedAt: null },
      data: { assignedTo },
    });
  }

  static async softDeleteMany(orgId: string, ids: string[]) {
    return prisma.deal.updateMany({
      where: { id: { in: ids }, orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}