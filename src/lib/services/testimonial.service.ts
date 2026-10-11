import { TestimonialRepository } from "@/lib/repositories/testimonial.repository";
import { MediaRepository } from "@/lib/repositories/media.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { emitEvent } from "@/lib/events/inngest";
import { NotFoundError, ValidationError } from "@/lib/utils/errors";
import type {
  CreateTestimonialInput,
  UpdateTestimonialInput,
  ReviewTestimonialInput,
  TestimonialFilters,
} from "@/lib/validations/testimonial.schema";
import type { PublicTestimonialInput } from "@/lib/validations/public-testimonial.schema";
import type { RequestContext } from "@/types";
import { prisma } from "@/lib/db/client";

export class TestimonialService {
  static async list(ctx: RequestContext, filters: TestimonialFilters) {
    return TestimonialRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const testimonial = await TestimonialRepository.findById(ctx.orgId, id);
    if (!testimonial) throw new NotFoundError("Testimonial", id);
    return testimonial;
  }

  static async create(ctx: RequestContext, input: CreateTestimonialInput) {
    const testimonial = await TestimonialRepository.create(ctx.orgId, input);

    // Phase 5: track avatar MediaUsage so referenced media can't be deleted
    if (input.avatarId) {
      await MediaRepository.trackUsage(ctx.orgId, input.avatarId, "testimonial", testimonial.id, "avatarId");
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "testimonial.submitted",
      entityType: "testimonial",
      entityId: testimonial.id,
      newValue: { authorName: input.authorName, courseId: input.courseId },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "submitted",
      objectType: "testimonial",
      objectId: testimonial.id,
      objectSnapshot: { authorName: input.authorName },
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "testimonial/submitted",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: { testimonialId: testimonial.id, authorName: input.authorName, courseId: input.courseId },
    });

    return testimonial;
  }

  /**
   * Unauthenticated submission from the marketing site. Always PENDING and never
   * featured; a courseId is kept only if it is a published course of this org.
   */
  static async submitPublic(orgId: string, input: PublicTestimonialInput, meta: { ipAddress?: string } = {}) {
    let courseId: string | null = null;
    if (input.courseId) {
      const course = await prisma.course.findFirst({
        where: { id: input.courseId, orgId, status: "PUBLISHED" },
        select: { id: true },
      });
      if (!course) throw new ValidationError([{ path: ["courseId"], message: "Unknown course" }]);
      courseId = course.id;
    }

    const testimonial = await prisma.testimonial.create({
      data: {
        orgId,
        authorName: input.authorName,
        authorTitle: input.authorTitle ?? null,
        authorEmail: input.authorEmail ?? null,
        content: input.content,
        rating: input.rating ?? null,
        courseId,
        batchYear: input.batchYear ?? null,
        status: "PENDING",
        isFeatured: false,
        source: "public_form",
        metadata: { consentAt: new Date().toISOString() },
      },
      select: { id: true, status: true, isFeatured: true, createdAt: true },
    });

    await AuditService.write({
      orgId,
      ipAddress: meta.ipAddress,
      action: "testimonial.submitted",
      entityType: "testimonial",
      entityId: testimonial.id,
      newValue: { authorName: input.authorName, courseId, source: "public_form" },
    });

    await ActivityFeedService.write({
      orgId,
      verb: "submitted",
      objectType: "testimonial",
      objectId: testimonial.id,
      objectSnapshot: { authorName: input.authorName },
      context: { actorName: "Public website" },
    });

    await emitEvent({
      name: "testimonial/submitted",
      orgId,
      actorId: "system",
      actorName: "Public website",
      requestId: testimonial.id,
      timestamp: new Date().toISOString(),
      data: { testimonialId: testimonial.id, authorName: input.authorName, courseId: courseId ?? undefined },
    });

    return testimonial;
  }

  static async update(ctx: RequestContext, id: string, input: UpdateTestimonialInput) {
    const existing = await this.getById(ctx, id);
    const updated = await TestimonialRepository.update(ctx.orgId, id, input);

    // Phase 5: reconcile avatar MediaUsage on change
    if (input.avatarId !== undefined && input.avatarId !== existing.avatarId) {
      if (existing.avatarId) {
        await MediaRepository.untrackUsage(existing.avatarId, "testimonial", id, "avatarId");
      }
      if (input.avatarId) {
        await MediaRepository.trackUsage(ctx.orgId, input.avatarId, "testimonial", id, "avatarId");
      }
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "testimonial.updated",
      entityType: "testimonial",
      entityId: id,
      oldValue: { authorName: existing.authorName },
      newValue: { authorName: input.authorName ?? existing.authorName },
    });

    return updated;
  }

  // Approval workflow
  static async review(ctx: RequestContext, id: string, input: ReviewTestimonialInput) {
    const existing = await this.getById(ctx, id);

    // APPROVED -> REJECTED unpublishes from the website; REJECTED -> APPROVED republishes.
    if (existing.status === input.status) {
      throw new ValidationError([{ message: `Testimonial is already ${existing.status}.` }]);
    }

    const updated = await TestimonialRepository.review(
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
      action: `testimonial.${input.status.toLowerCase()}`,
      entityType: "testimonial",
      entityId: id,
      oldValue: { status: existing.status },
      newValue: { status: input.status, reviewNotes: input.reviewNotes },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: input.status === "APPROVED" ? "approved" : "rejected",
      objectType: "testimonial",
      objectId: id,
      objectSnapshot: { authorName: existing.authorName, status: input.status },
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "testimonial/reviewed",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: { testimonialId: id, status: input.status, reviewedBy: ctx.user.id },
    });

    return updated;
  }

  static async delete(ctx: RequestContext, id: string) {
    const existing = await this.getById(ctx, id);
    await TestimonialRepository.delete(ctx.orgId, id);

    // Phase 5: release avatar MediaUsage so the asset can be deleted
    if (existing.avatarId) {
      await MediaRepository.untrackUsage(existing.avatarId, "testimonial", id, "avatarId");
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "testimonial.deleted",
      entityType: "testimonial",
      entityId: id,
      oldValue: { authorName: existing.authorName, status: existing.status },
    });
  }

  static async getPendingCount(ctx: RequestContext) {
    return TestimonialRepository.findPendingCount(ctx.orgId);
  }
}
