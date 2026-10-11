import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type {
  CreateJobInput,
  UpdateJobInput,
  JobFilters,
  CreateJobApplicationInput,
  JobApplicationFilters,
} from "@/lib/validations/job.schema";

const JOB_SELECT = {
  id: true,
  orgId: true,
  hiringPartnerId: true,
  title: true,
  slug: true,
  description: true,
  requirements: true,
  location: true,
  isRemote: true,
  jobType: true,
  salaryMin: true,
  salaryMax: true,
  currency: true,
  experienceYears: true,
  status: true,
  publishedAt: true,
  closesAt: true,
  tags: true,
  courseIds: true,
  seoTitle: true,
  seoDesc: true,
  metadata: true,
  publishedBy: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  hiringPartner: { select: { id: true, name: true, logoId: true } },
  creator: { select: { id: true, name: true } },
  publisher: { select: { id: true, name: true } },
  _count: { select: { applications: true } },
} satisfies Prisma.JobSelect;

const APPLICATION_SELECT = {
  id: true,
  orgId: true,
  jobId: true,
  studentId: true,
  applicantName: true,
  applicantEmail: true,
  applicantPhone: true,
  resumeUrl: true,
  coverLetter: true,
  status: true,
  reviewedBy: true,
  reviewedAt: true,
  reviewNotes: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  job: { select: { id: true, title: true, slug: true } },
  student: { select: { id: true, firstName: true, lastName: true, email: true } },
  reviewer: { select: { id: true, name: true } },
} satisfies Prisma.JobApplicationSelect;

/** The API contract exposes a flat `applicationCount`; Prisma's `_count` stays internal. */
export function withApplicationCount<T extends { _count: { applications: number } }>(row: T) {
  const { _count, ...rest } = row;
  return { ...rest, applicationCount: _count.applications };
}

export class JobRepository {
  static async findMany(orgId: string, filters: JobFilters) {
    const where: Prisma.JobWhereInput = {
      orgId,
      ...(filters.status && { status: filters.status }),
      ...(filters.hiringPartnerId && { hiringPartnerId: filters.hiringPartnerId }),
      ...(filters.jobType && { jobType: filters.jobType }),
      ...(filters.isRemote !== undefined && { isRemote: filters.isRemote }),
      ...(filters.search && {
        OR: [
          { title: { contains: filters.search, mode: "insensitive" as const } },
          { description: { contains: filters.search, mode: "insensitive" as const } },
        ],
      }),
    };

    const skip = (filters.page - 1) * filters.limit;
    const [data, total] = await Promise.all([
      prisma.job.findMany({
        where,
        select: JOB_SELECT,
        skip,
        take: filters.limit,
        orderBy: { [filters.sortBy]: filters.sortDir },
      }),
      prisma.job.count({ where }),
    ]);
    return { data: data.map(withApplicationCount), total };
  }

  static async findById(orgId: string, id: string) {
    const row = await prisma.job.findFirst({ where: { id, orgId }, select: JOB_SELECT });
    return row ? withApplicationCount(row) : null;
  }

  static async findBySlug(orgId: string, slug: string) {
    return prisma.job.findFirst({ where: { slug, orgId }, select: JOB_SELECT });
  }

  static async create(
    orgId: string,
    createdBy: string | null,
    data: CreateJobInput,
    slug: string,
    db: Prisma.TransactionClient = prisma,
  ) {
    return withApplicationCount(await db.job.create({
      data: {
        orgId,
        createdBy,
        slug,
        title: data.title,
        hiringPartnerId: data.hiringPartnerId,
        description: data.description,
        requirements: data.requirements,
        location: data.location,
        isRemote: data.isRemote ?? false,
        jobType: data.jobType ?? "full_time",
        salaryMin: data.salaryMin,
        salaryMax: data.salaryMax,
        currency: data.currency ?? "INR",
        experienceYears: data.experienceYears,
        closesAt: data.closesAt ? new Date(data.closesAt) : undefined,
        tags: data.tags ?? [],
        courseIds: data.courseIds ?? [],
        seoTitle: data.seoTitle,
        seoDesc: data.seoDesc,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: JOB_SELECT,
    }));
  }

  static async update(orgId: string, id: string, data: UpdateJobInput) {
    return withApplicationCount(await prisma.job.update({
      where: { id, orgId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.slug !== undefined && { slug: data.slug }),
        ...(data.hiringPartnerId !== undefined && { hiringPartnerId: data.hiringPartnerId }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.requirements !== undefined && { requirements: data.requirements }),
        ...(data.location !== undefined && { location: data.location }),
        ...(data.isRemote !== undefined && { isRemote: data.isRemote }),
        ...(data.jobType !== undefined && { jobType: data.jobType }),
        ...(data.salaryMin !== undefined && { salaryMin: data.salaryMin }),
        ...(data.salaryMax !== undefined && { salaryMax: data.salaryMax }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.experienceYears !== undefined && { experienceYears: data.experienceYears }),
        ...(data.closesAt !== undefined && { closesAt: data.closesAt ? new Date(data.closesAt) : null }),
        ...(data.tags !== undefined && { tags: data.tags }),
        ...(data.courseIds !== undefined && { courseIds: data.courseIds }),
        ...(data.seoTitle !== undefined && { seoTitle: data.seoTitle }),
        ...(data.seoDesc !== undefined && { seoDesc: data.seoDesc }),
        ...(data.metadata !== undefined && { metadata: data.metadata as Prisma.InputJsonValue }),
      },
      select: JOB_SELECT,
    }));
  }

  static async updateStatus(orgId: string, id: string, status: string, publishedBy?: string) {
    return withApplicationCount(await prisma.job.update({
      where: { id, orgId },
      data: {
        status: status as "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED",
        ...(status === "PUBLISHED" && { publishedAt: new Date(), publishedBy }),
      },
      select: JOB_SELECT,
    }));
  }

  static async delete(orgId: string, id: string) {
    return prisma.job.update({
      where: { id, orgId },
      data: { status: "ARCHIVED" },
      select: { id: true },
    });
  }
}

export class JobApplicationRepository {
  static async findMany(orgId: string, filters: JobApplicationFilters) {
    const where: Prisma.JobApplicationWhereInput = {
      orgId,
      ...(filters.jobId && { jobId: filters.jobId }),
      ...(filters.studentId && { studentId: filters.studentId }),
      ...(filters.status && { status: filters.status }),
      ...(filters.search && {
        OR: [
          { applicantName: { contains: filters.search, mode: "insensitive" as const } },
          { applicantEmail: { contains: filters.search, mode: "insensitive" as const } },
        ],
      }),
    };

    const skip = (filters.page - 1) * filters.limit;
    const [data, total] = await Promise.all([
      prisma.jobApplication.findMany({
        where,
        select: APPLICATION_SELECT,
        skip,
        take: filters.limit,
        orderBy: { [filters.sortBy]: filters.sortDir },
      }),
      prisma.jobApplication.count({ where }),
    ]);
    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.jobApplication.findFirst({ where: { id, orgId }, select: APPLICATION_SELECT });
  }

  static async create(orgId: string, data: CreateJobApplicationInput) {
    return prisma.jobApplication.create({
      data: {
        orgId,
        jobId: data.jobId,
        studentId: data.studentId,
        applicantName: data.applicantName,
        applicantEmail: data.applicantEmail,
        applicantPhone: data.applicantPhone,
        resumeUrl: data.resumeUrl,
        coverLetter: data.coverLetter,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: APPLICATION_SELECT,
    });
  }

  static async updateStatus(
    orgId: string,
    id: string,
    status: string,
    reviewedBy: string,
    reviewNotes?: string,
  ) {
    return prisma.jobApplication.update({
      where: { id, orgId },
      data: {
        status: status as "SUBMITTED" | "UNDER_REVIEW" | "SHORTLISTED" | "INTERVIEW_SCHEDULED" | "SELECTED" | "REJECTED" | "WITHDRAWN",
        reviewedBy,
        reviewedAt: new Date(),
        ...(reviewNotes !== undefined && { reviewNotes }),
      },
      select: APPLICATION_SELECT,
    });
  }

  static async delete(orgId: string, id: string) {
    return prisma.jobApplication.delete({ where: { id, orgId } });
  }

  static async countByJob(jobId: string) {
    return prisma.jobApplication.count({ where: { jobId } });
  }
}
