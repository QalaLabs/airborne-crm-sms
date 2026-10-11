import { JobRepository, JobApplicationRepository } from "@/lib/repositories/job.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { emitEvent } from "@/lib/events/inngest";
import { NotFoundError, ConflictError, ValidationError } from "@/lib/utils/errors";
import { JOB_STATUS_TRANSITIONS } from "@/lib/validations/job.schema";
import type {
  CreateJobInput,
  UpdateJobInput,
  PublishJobInput,
  JobFilters,
  CreateJobApplicationInput,
  UpdateJobApplicationStatusInput,
  JobApplicationFilters,
} from "@/lib/validations/job.schema";
import type { PublicJobApplicationInput } from "@/lib/validations/public-job-application.schema";
import type { RequestContext } from "@/types";
import { prisma } from "@/lib/db/client";

export function generateSlug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/[\s]+/g, "-");
}

async function ensureUniqueSlug(orgId: string, base: string, excludeId?: string): Promise<string> {
  let slug = base;
  let n = 1;
  for (;;) {
    const existing = await prisma.job.findFirst({ where: { orgId, slug }, select: { id: true } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${++n}`;
  }
}

// ─── Job Service ──────────────────────────────────────────────────────────────

export class JobService {
  static async list(ctx: RequestContext, filters: JobFilters) {
    return JobRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const job = await JobRepository.findById(ctx.orgId, id);
    if (!job) throw new NotFoundError("Job", id);
    return job;
  }

  static async create(ctx: RequestContext, input: CreateJobInput) {
    const baseSlug = input.slug ?? generateSlug(input.title);
    const slug = await ensureUniqueSlug(ctx.orgId, baseSlug);

    const job = await JobRepository.create(ctx.orgId, ctx.user.id, input, slug);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "job.created",
      entityType: "job",
      entityId: job.id,
      newValue: { title: job.title, slug: job.slug },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "created",
      objectType: "job",
      objectId: job.id,
      objectSnapshot: { title: job.title, slug: job.slug },
      context: { actorName: ctx.user.name },
    });

    return job;
  }

  static async update(ctx: RequestContext, id: string, input: UpdateJobInput) {
    const existing = await this.getById(ctx, id);

    if (input.slug && input.slug !== existing.slug) {
      const conflict = await prisma.job.findFirst({
        where: { orgId: ctx.orgId, slug: input.slug },
        select: { id: true },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictError(`Slug "${input.slug}" already in use.`);
      }
    }

    const updated = await JobRepository.update(ctx.orgId, id, input);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "job.updated",
      entityType: "job",
      entityId: id,
      oldValue: { title: existing.title, status: existing.status },
      newValue: { title: input.title ?? existing.title },
    });

    return updated;
  }

  static async publish(ctx: RequestContext, id: string, input: PublishJobInput) {
    const existing = await this.getById(ctx, id);
    const fromStatus = existing.status as string;
    const toStatus = input.status;

    const allowed = JOB_STATUS_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new ValidationError([
        { message: `Cannot transition from ${fromStatus} to ${toStatus}. Allowed: ${allowed.join(", ")}` },
      ]);
    }

    const job = await JobRepository.updateStatus(
      ctx.orgId,
      id,
      toStatus,
      toStatus === "PUBLISHED" ? ctx.user.id : undefined,
    );

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: `job.${toStatus.toLowerCase()}`,
      entityType: "job",
      entityId: id,
      oldValue: { status: fromStatus },
      newValue: { status: toStatus },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: toStatus === "PUBLISHED" ? "published" : toStatus.toLowerCase(),
      objectType: "job",
      objectId: id,
      objectSnapshot: { title: job.title, slug: job.slug, status: toStatus },
      context: { actorName: ctx.user.name },
    });

    if (toStatus === "PUBLISHED") {
      await emitEvent({
        name: "job/published",
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        requestId: ctx.requestId,
        timestamp: new Date().toISOString(),
        data: {
          jobId: id,
          slug: job.slug,
          title: job.title,
          hiringPartnerId: job.hiringPartnerId ?? undefined,
        },
      });
    }

    await emitEvent({
      name: "job/status.changed",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: { jobId: id, slug: job.slug, fromStatus, toStatus },
    });

    return job;
  }

  static async delete(ctx: RequestContext, id: string) {
    const existing = await this.getById(ctx, id);
    await JobRepository.delete(ctx.orgId, id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "job.archived",
      entityType: "job",
      entityId: id,
      oldValue: { title: existing.title, status: existing.status },
      newValue: { status: "ARCHIVED" },
    });
  }
}

// ─── Job Application Service ──────────────────────────────────────────────────

export class JobApplicationService {
  static async list(ctx: RequestContext, filters: JobApplicationFilters) {
    return JobApplicationRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const app = await JobApplicationRepository.findById(ctx.orgId, id);
    if (!app) throw new NotFoundError("JobApplication", id);
    return app;
  }

  static async submit(ctx: RequestContext, input: CreateJobApplicationInput) {
    // Verify job exists and is open
    const job = await JobRepository.findById(ctx.orgId, input.jobId);
    if (!job) throw new NotFoundError("Job", input.jobId);
    if (job.status !== "PUBLISHED") {
      throw new ValidationError([{ message: "Job is not open for applications." }]);
    }

    const application = await JobApplicationRepository.create(ctx.orgId, input);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "job_application.submitted",
      entityType: "job_application",
      entityId: application.id,
      newValue: { jobId: input.jobId, applicantEmail: input.applicantEmail },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "submitted",
      objectType: "job_application",
      objectId: application.id,
      objectSnapshot: { applicantName: input.applicantName, jobId: input.jobId },
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "job_application/submitted",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        applicationId: application.id,
        jobId: input.jobId,
        jobTitle: job.title,
        applicantName: input.applicantName,
        applicantEmail: input.applicantEmail,
      },
    });

    return application;
  }

  /**
   * Unauthenticated application from the public job portal. The org is resolved
   * server-side by the caller; the job must be PUBLISHED and not past closesAt.
   * One active application per (job, email): the job row is locked so two
   * concurrent submissions cannot both pass the duplicate check.
   */
  static async submitPublic(
    orgId: string,
    input: PublicJobApplicationInput,
    meta: { ipAddress?: string } = {},
  ) {
    const job = await prisma.job.findFirst({
      where: { id: input.jobId, orgId },
      select: { id: true, title: true, status: true, closesAt: true },
    });
    if (!job) throw new NotFoundError("Job");
    if (job.status !== "PUBLISHED") throw new ConflictError("This job is not accepting applications.");
    if (job.closesAt && job.closesAt.getTime() < Date.now()) {
      throw new ConflictError("Applications for this job have closed.");
    }

    const application = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${job.id}::uuid FOR UPDATE`;
      const duplicate = await tx.jobApplication.findFirst({
        where: {
          orgId,
          jobId: job.id,
          applicantEmail: { equals: input.applicantEmail, mode: "insensitive" },
          status: { not: "WITHDRAWN" },
        },
        select: { id: true },
      });
      if (duplicate) throw new ConflictError("You have already applied for this job.");
      return tx.jobApplication.create({
        data: {
          orgId,
          jobId: job.id,
          applicantName: input.applicantName,
          applicantEmail: input.applicantEmail,
          applicantPhone: input.applicantPhone,
          resumeUrl: input.resumeUrl ?? null,
          coverLetter: input.coverLetter ?? null,
          metadata: { source: "public_portal", consentAt: new Date().toISOString() },
        },
        select: { id: true, jobId: true, status: true, createdAt: true },
      });
    });

    await AuditService.write({
      orgId,
      ipAddress: meta.ipAddress,
      action: "job_application.submitted",
      entityType: "job_application",
      entityId: application.id,
      newValue: { jobId: job.id, applicantEmail: input.applicantEmail, source: "public_portal" },
    });

    await ActivityFeedService.write({
      orgId,
      verb: "submitted",
      objectType: "job_application",
      objectId: application.id,
      objectSnapshot: { applicantName: input.applicantName, jobId: job.id },
      context: { actorName: "Public job portal" },
    });

    await emitEvent({
      name: "job_application/submitted",
      orgId,
      actorId: "system",
      actorName: "Public job portal",
      requestId: application.id,
      timestamp: new Date().toISOString(),
      data: {
        applicationId: application.id,
        jobId: job.id,
        jobTitle: job.title,
        applicantName: input.applicantName,
        applicantEmail: input.applicantEmail,
      },
    });

    return application;
  }

  static async updateStatus(
    ctx: RequestContext,
    id: string,
    input: UpdateJobApplicationStatusInput,
  ) {
    const existing = await this.getById(ctx, id);
    const updated = await JobApplicationRepository.updateStatus(
      ctx.orgId,
      id,
      input.status,
      ctx.user.id,
      input.reviewNotes,
    );

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "job_application.status_changed",
      entityType: "job_application",
      entityId: id,
      oldValue: { status: existing.status },
      newValue: { status: input.status, reviewNotes: input.reviewNotes },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "reviewed",
      objectType: "job_application",
      objectId: id,
      objectSnapshot: { status: input.status, applicantName: existing.applicantName },
      context: { actorName: ctx.user.name, from: existing.status, to: input.status },
    });

    await emitEvent({
      name: "job_application/status.changed",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        applicationId: id,
        jobId: existing.jobId,
        fromStatus: existing.status,
        toStatus: input.status,
        applicantEmail: existing.applicantEmail,
      },
    });

    return updated;
  }

  static async delete(ctx: RequestContext, id: string) {
    await this.getById(ctx, id);
    await JobApplicationRepository.delete(ctx.orgId, id);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "job_application.deleted",
      entityType: "job_application",
      entityId: id,
    });
  }
}
