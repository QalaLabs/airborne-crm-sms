import { prisma } from "@/lib/db/client";
import type { LeadFilters, CreateLeadInput, UpdateLeadInput } from "@/lib/validations/lead.schema";
import { LEAD_PRIORITY_SCORE } from "@/lib/validations/lead.schema";
import { ACTIVE_LEAD_STATUSES } from "@/lib/leads/lead-status";
import type { Prisma } from "@prisma/client";

export function scoreRangeForPriority(priority: keyof typeof LEAD_PRIORITY_SCORE): { gte?: number; lt?: number } {
  const threshold = LEAD_PRIORITY_SCORE[priority];
  if (priority === "HIGH") return { gte: threshold };
  if (priority === "MEDIUM") return { gte: threshold, lt: LEAD_PRIORITY_SCORE.HIGH };
  return { lt: LEAD_PRIORITY_SCORE.MEDIUM };
}

const LEAD_SELECT = {
  id: true,
  orgId: true,
  campusId: true,
  name: true,
  email: true,
  phone: true,
  city: true,
  state: true,
  pincode: true,
  googleId: true,
  manualAmount: true,
  courseInterest: true,
  source: true,
  status: true,
  score: true,
  tags: true,
  assignedTo: true,
  createdBy: true,
  utmSource: true,
  utmMedium: true,
  utmCampaign: true,
  utmTerm: true,
  utmContent: true,
  referrerUrl: true,
  landingPage: true,
  isDuplicate: true,
  nextFollowUp: true,
  lastActivityAt: true,
  convertedAt: true,
  lostReason: true,
  customFields: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  counselor: { select: { id: true, name: true, avatarUrl: true, email: true } },
  campus: { select: { id: true, name: true, city: true } },
  admissions: {
    select: {
      id: true,
      applicationNo: true,
      stage: true,
      courseName: true,
      batchName: true,
      feeAmount: true,
      feePaid: true,
      feeBalance: true,
      feeFinal: true,
      studentId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  },
  scoreHistory: {
    select: { id: true, score: true, reason: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  },
  deals: {
    select: {
      id: true,
      title: true,
      stage: true,
      value: true,
      currency: true,
      expectedCloseAt: true,
      source: true,
      assignedTo: true,
      lostReason: true,
      wonAt: true,
      lostAt: true,
      convertedAt: true,
      revertedAt: true,
      isActive: true,
      createdAt: true,
      admissionId: true,
      admission: { select: { id: true, applicationNo: true, stage: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  },
} satisfies Prisma.LeadSelect;

const LEAD_LIST_SELECT = {
  id: true,
  orgId: true,
  campusId: true,
  name: true,
  email: true,
  phone: true,
  city: true,
  state: true,
  pincode: true,
  googleId: true,
  manualAmount: true,
  courseInterest: true,
  source: true,
  status: true,
  score: true,
  tags: true,
  assignedTo: true,
  createdBy: true,
  utmSource: true,
  utmMedium: true,
  utmCampaign: true,
  utmTerm: true,
  utmContent: true,
  referrerUrl: true,
  landingPage: true,
  isDuplicate: true,
  nextFollowUp: true,
  lastActivityAt: true,
  convertedAt: true,
  lostReason: true,
  customFields: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  counselor: { select: { id: true, name: true, avatarUrl: true, email: true } },
  campus: { select: { id: true, name: true, city: true } },
  admissions: {
    where: { stage: { notIn: ["CANCELLED", "DROPPED"] } },
    select: { id: true, applicationNo: true, stage: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  activities: {
    where: { activityType: "MEETING" },
    select: { id: true, activityType: true, metadata: true, dueAt: true, completedAt: true, title: true },
    take: 5,
  },
  deals: {
    select: { id: true, title: true, stage: true, value: true, isActive: true },
    take: 1,
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.LeadSelect;

export type LeadWhereFilters = Omit<LeadFilters, "page" | "limit" | "sortBy" | "sortDir">;

/** Canonical lead list query, shared by the paginated list and the CSV export. */
export function buildLeadWhere(orgId: string, filters: LeadWhereFilters, now: Date = new Date()): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {
    orgId,
    deletedAt: null,
  };

  if (filters.isActive) {
    where.status = { in: ACTIVE_LEAD_STATUSES };
  } else if (filters.status) {
    where.status = filters.status;
  }

  if (filters.source) where.source = filters.source;
  if (filters.assignedTo) where.assignedTo = filters.assignedTo;
  if (filters.campusId) where.campusId = filters.campusId;
  if (filters.courseInterest) {
    where.courseInterest = { contains: filters.courseInterest, mode: "insensitive" };
  }
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { email: { contains: filters.search, mode: "insensitive" } },
      { phone: { contains: filters.search } },
    ];
  }
  if (filters.lostReason) {
    where.lostReason = { contains: filters.lostReason, mode: "insensitive" };
  }
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
      ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
    };
  }
  if (filters.followUpOverdue) {
    where.nextFollowUp = { lt: now };
    if (!filters.status && !filters.isActive) {
      where.status = { in: ACTIVE_LEAD_STATUSES };
    }
  }
  if (filters.priority) {
    where.score = scoreRangeForPriority(filters.priority);
  }
  return where;
}

/** Export ordering: `id` breaks ties so keyset batches never overlap or skip rows. */
export function leadExportOrderBy(
  sortBy: LeadFilters["sortBy"],
  sortDir: LeadFilters["sortDir"],
): Prisma.LeadOrderByWithRelationInput[] {
  return [{ [sortBy]: sortDir }, { id: sortDir }];
}

export const LEAD_EXPORT_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  city: true,
  state: true,
  pincode: true,
  courseInterest: true,
  source: true,
  status: true,
  score: true,
  manualAmount: true,
  lostReason: true,
  nextFollowUp: true,
  lastActivityAt: true,
  createdAt: true,
  utmSource: true,
  utmMedium: true,
  utmCampaign: true,
  counselor: { select: { name: true } },
  campus: { select: { name: true } },
} satisfies Prisma.LeadSelect;

export type LeadExportRow = Prisma.LeadGetPayload<{ select: typeof LEAD_EXPORT_SELECT }>;

export class LeadRepository {
  static async findMany(orgId: string, filters: LeadFilters) {
    const where = buildLeadWhere(orgId, filters);
    const skip = (filters.page - 1) * filters.limit;

    const [data, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        select: LEAD_LIST_SELECT,
        orderBy: { [filters.sortBy]: filters.sortDir },
        skip,
        take: filters.limit,
      }),
      prisma.lead.count({ where }),
    ]);

    return { data, total };
  }

  /**
   * Streams every lead matching `filters` in keyset-paginated batches so memory
   * stays bounded regardless of result size.
   */
  static async *iterateForExport(
    orgId: string,
    filters: LeadWhereFilters & Pick<LeadFilters, "sortBy" | "sortDir">,
    batchSize = 500,
  ): AsyncGenerator<LeadExportRow[]> {
    const where = buildLeadWhere(orgId, filters);
    const orderBy = leadExportOrderBy(filters.sortBy, filters.sortDir);
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.lead.findMany({
        where,
        select: LEAD_EXPORT_SELECT,
        orderBy,
        take: batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (batch.length === 0) return;
      yield batch;
      if (batch.length < batchSize) return;
      cursor = batch[batch.length - 1]!.id;
    }
  }

  static async countForExport(orgId: string, filters: LeadWhereFilters): Promise<number> {
    return prisma.lead.count({ where: buildLeadWhere(orgId, filters) });
  }
  static async findById(orgId: string, id: string) {
    return prisma.lead.findFirst({
      where: { id, orgId, deletedAt: null },
      select: LEAD_SELECT,
    });
  }

  static async create(orgId: string, createdBy: string, data: CreateLeadInput) {
    return prisma.lead.create({
      data: {
        orgId,
        createdBy,
        name: data.name,
        email: data.email || null,
        phone: data.phone,
        city: data.city,
        state: data.state,
        pincode: data.pincode,
        googleId: data.googleId,
        manualAmount: data.manualAmount !== undefined ? data.manualAmount : undefined,
        courseInterest: data.courseInterest,
        source: data.source,
        assignedTo: data.assignedTo,
        campusId: data.campusId,
        utmSource: data.utmSource,
        utmMedium: data.utmMedium,
        utmCampaign: data.utmCampaign,
        utmTerm: data.utmTerm,
        utmContent: data.utmContent,
        referrerUrl: data.referrerUrl || null,
        landingPage: data.landingPage,
        tags: data.tags ?? [],
        customFields: (data.customFields ?? {}) as Prisma.InputJsonValue,
        nextFollowUp: data.nextFollowUp ? new Date(data.nextFollowUp) : null,
      },
      select: LEAD_SELECT,
    });
  }

  static async update(orgId: string, id: string, data: UpdateLeadInput) {
    return prisma.lead.update({
      where: { id, orgId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.email !== undefined && { email: data.email || null }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.city !== undefined && { city: data.city }),
        ...(data.state !== undefined && { state: data.state }),
        ...(data.pincode !== undefined && { pincode: data.pincode }),
        ...(data.googleId !== undefined && { googleId: data.googleId }),
        ...(data.manualAmount !== undefined && { manualAmount: data.manualAmount }),
        ...(data.courseInterest !== undefined && { courseInterest: data.courseInterest }),
        ...(data.source !== undefined && { source: data.source }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.assignedTo !== undefined && { assignedTo: data.assignedTo }),
        ...(data.campusId !== undefined && { campusId: data.campusId ?? null }),
        ...(data.tags !== undefined && { tags: data.tags }),
        ...(data.customFields !== undefined && { customFields: data.customFields as Prisma.InputJsonValue }),
        ...(data.lostReason !== undefined && { lostReason: data.lostReason }),
        ...(data.nextFollowUp !== undefined && {
          nextFollowUp: data.nextFollowUp ? new Date(data.nextFollowUp) : null,
        }),
      } as Prisma.LeadUncheckedUpdateInput,
      select: LEAD_SELECT,
    });
  }

  static async softDelete(orgId: string, id: string) {
    return prisma.lead.update({
      where: { id, orgId },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }

  static async getStatusCounts(orgId: string) {
    return prisma.lead.groupBy({
      by: ["status"],
      where: { orgId, deletedAt: null },
      _count: { status: true },
    });
  }

  static async getSourceCounts(orgId: string) {
    return prisma.lead.groupBy({
      by: ["source"],
      where: { orgId, deletedAt: null },
      _count: { source: true },
    });
  }
}
