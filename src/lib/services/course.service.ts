import { CourseRepository } from "@/lib/repositories/course.repository";
import { MediaRepository } from "@/lib/repositories/media.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { emitEvent } from "@/lib/events/inngest";
import { NotFoundError, ConflictError, ValidationError } from "@/lib/utils/errors";
import { CONTENT_STATUS_TRANSITIONS } from "@/lib/validations/page.schema";
import type {
  CreateCourseInput,
  UpdateCourseInput,
  PublishCourseInput,
  CourseFilters,
} from "@/lib/validations/course.schema";
import type { ContentStatus } from "@prisma/client";
import type { RequestContext } from "@/types";
import { prisma } from "@/lib/db/client";

function generateSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s]+/g, "-");
}

async function ensureUniqueSlug(orgId: string, base: string, excludeId?: string): Promise<string> {
  let slug = base;
  let n = 1;
  for (;;) {
    const existing = await prisma.course.findFirst({ where: { orgId, slug }, select: { id: true } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${++n}`;
  }
}

export class CourseService {
  static async list(ctx: RequestContext, filters: CourseFilters) {
    return CourseRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const course = await CourseRepository.findById(ctx.orgId, id);
    if (!course) throw new NotFoundError("Course", id);
    return course;
  }

  static async create(ctx: RequestContext, input: CreateCourseInput) {
    const baseSlug = input.slug ?? generateSlug(input.title);
    const slug = await ensureUniqueSlug(ctx.orgId, baseSlug);

    const course = await CourseRepository.create(ctx.orgId, ctx.user.id, input, slug);

    // create a version snapshot when a course is created directly as PUBLISHED
    if (course.status === "PUBLISHED") {
      const versionRecord = await CourseRepository.createVersion(
        ctx.orgId,
        course.id,
        course.version,
        course,
        "PUBLISHED",
        ctx.user.id,
        "Created as published",
      );

      await emitEvent({
        name: "course/published",
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        requestId: ctx.requestId,
        timestamp: new Date().toISOString(),
        data: {
          courseId: course.id,
          slug: course.slug,
          title: course.title,
          version: course.version,
          versionId: versionRecord.id,
        },
      });

      // Sync audit + activity parity with publish() — create-as-PUBLISHED previously
      // relied on the (disabled) Inngest handler for the publish record.
      await AuditService.write({
        orgId: ctx.orgId,
        userId: ctx.user.id,
        requestId: ctx.requestId,
        action: "course.published",
        entityType: "course",
        entityId: course.id,
        newValue: { title: course.title, slug: course.slug, status: "PUBLISHED" },
      });

      await ActivityFeedService.write({
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        verb: "published",
        objectType: "course",
        objectId: course.id,
        objectSnapshot: { title: course.title, slug: course.slug, status: "PUBLISHED" },
        context: { actorName: ctx.user.name },
      });
    }

    // B-04: track media usage for banner and gallery images
    if (input.bannerImageId) {
      await MediaRepository.trackUsage(ctx.orgId, input.bannerImageId, "course", course.id, "bannerImageId");
    }
    for (const imgId of input.galleryIds ?? []) {
      await MediaRepository.trackUsage(ctx.orgId, imgId, "course", course.id, `gallery:${imgId}`);
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "course.created",
      entityType: "course",
      entityId: course.id,
      newValue: { title: course.title, slug: course.slug },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "created",
      objectType: "course",
      objectId: course.id,
      objectSnapshot: { title: course.title, slug: course.slug },
      context: { actorName: ctx.user.name },
    });

    return course;
  }

  static async update(ctx: RequestContext, id: string, input: UpdateCourseInput) {
    const existing = await this.getById(ctx, id);

    if (input.slug && input.slug !== existing.slug) {
      const conflict = await prisma.course.findFirst({
        where: { orgId: ctx.orgId, slug: input.slug },
        select: { id: true },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictError(`Slug "${input.slug}" is already used by another course.`);
      }
    }

    const updated = await CourseRepository.update(ctx.orgId, id, input);

    // B-04: reconcile media usage for banner and gallery changes
    if (input.bannerImageId !== undefined && input.bannerImageId !== existing.bannerImageId) {
      if (existing.bannerImageId) {
        await MediaRepository.untrackUsage(existing.bannerImageId, "course", id, "bannerImageId");
      }
      if (input.bannerImageId) {
        await MediaRepository.trackUsage(ctx.orgId, input.bannerImageId, "course", id, "bannerImageId");
      }
    }
    if (input.galleryIds !== undefined) {
      const oldIds = new Set(existing.galleryIds ?? []);
      const newIds = new Set(input.galleryIds);
      for (const imgId of Array.from(oldIds).filter((x) => !newIds.has(x))) {
        await MediaRepository.untrackUsage(imgId, "course", id, `gallery:${imgId}`);
      }
      for (const imgId of Array.from(newIds).filter((x) => !oldIds.has(x))) {
        await MediaRepository.trackUsage(ctx.orgId, imgId, "course", id, `gallery:${imgId}`);
      }
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "course.updated",
      entityType: "course",
      entityId: id,
      oldValue: { title: existing.title, status: existing.status },
      newValue: { title: input.title ?? existing.title },
    });

    return updated;
  }

  static async delete(ctx: RequestContext, id: string) {
    const existing = await this.getById(ctx, id);

    // Archive instead of hard delete
    const updated = await CourseRepository.updateStatus(ctx.orgId, id, "ARCHIVED", ctx.user.id);

    // B-04: release media usage so assets referenced by archived courses can be deleted
    if (existing.bannerImageId) {
      await MediaRepository.untrackUsage(existing.bannerImageId, "course", id, "bannerImageId");
    }
    for (const imgId of existing.galleryIds ?? []) {
      await MediaRepository.untrackUsage(imgId, "course", id, `gallery:${imgId}`);
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "course.archived",
      entityType: "course",
      entityId: id,
      oldValue: { status: existing.status },
      newValue: { status: "ARCHIVED" },
    });

    return updated;
  }

  static async publish(ctx: RequestContext, id: string, input: PublishCourseInput) {
    const existing = await this.getById(ctx, id);
    const fromStatus = existing.status as ContentStatus;
    const toStatus = input.status as ContentStatus;

    const allowed = CONTENT_STATUS_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new ValidationError([
        { message: `Cannot transition from ${fromStatus} to ${toStatus}. Allowed: ${allowed.join(", ")}` },
      ]);
    }

    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    const course = await CourseRepository.updateStatus(ctx.orgId, id, toStatus, ctx.user.id, scheduledAt);

    let versionRecord = null;
    if (toStatus === "PUBLISHED") {
      versionRecord = await CourseRepository.createVersion(
        ctx.orgId,
        id,
        course.version,
        course,
        toStatus,
        ctx.user.id,
        input.notes,
      );

      await emitEvent({
        name: "course/published",
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        requestId: ctx.requestId,
        timestamp: new Date().toISOString(),
        data: {
          courseId: id,
          slug: course.slug,
          title: course.title,
          version: course.version,
          versionId: versionRecord.id,
        },
      });
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: `course.${toStatus.toLowerCase()}`,
      entityType: "course",
      entityId: id,
      oldValue: { status: fromStatus },
      newValue: { status: toStatus, scheduledAt: scheduledAt?.toISOString() },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: toStatus === "PUBLISHED" ? "published" : toStatus.toLowerCase(),
      objectType: "course",
      objectId: id,
      objectSnapshot: { title: course.title, slug: course.slug, status: toStatus },
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "course/status.changed",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        courseId: id,
        slug: course.slug,
        title: course.title,
        fromStatus,
        toStatus,
        scheduledAt: scheduledAt?.toISOString(),
      },
    });

    return { course, version: versionRecord };
  }

  static async listVersions(ctx: RequestContext, courseId: string) {
    await this.getById(ctx, courseId);
    return CourseRepository.listVersions(ctx.orgId, courseId);
  }

  static async rollback(ctx: RequestContext, courseId: string, versionId: string) {
    const existing = await this.getById(ctx, courseId);
    const versionRow = await CourseRepository.findVersion(ctx.orgId, courseId, versionId);
    if (!versionRow) throw new NotFoundError("CourseVersion", versionId);

    const snapshot = versionRow.snapshot as UpdateCourseInput;
    const newVersion = existing.version + 1;

    await CourseRepository.update(ctx.orgId, courseId, { ...snapshot, slug: existing.slug });
    // B-06: route through repository instead of calling prisma directly
    await CourseRepository.setVersionStatus(ctx.orgId, courseId, newVersion, "DRAFT");

    const newVersionRecord = await CourseRepository.createVersion(
      ctx.orgId,
      courseId,
      newVersion,
      snapshot,
      "DRAFT",
      ctx.user.id,
      `Rolled back to v${versionRow.version}`,
    );

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "course.rolled_back",
      entityType: "course",
      entityId: courseId,
      oldValue: { version: existing.version },
      newValue: { version: newVersion, rolledBackTo: versionRow.version },
    });

    await emitEvent({
      name: "content/version.created",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        entityType: "course",
        entityId: courseId,
        version: newVersion,
        versionId: newVersionRecord.id,
        notes: `Rolled back to v${versionRow.version}`,
      },
    });

    return CourseRepository.findById(ctx.orgId, courseId);
  }

  // B-05: now creates version snapshot and emits course/published + course/status.changed
  static async publishScheduledCourses() {
    const due = await CourseRepository.findScheduledDue();
    for (const c of due) {
      const updated = await CourseRepository.claimScheduledPublish(c.orgId, c.id);
      if (!updated) continue; // already claimed by a concurrent/retried execution
      const versionRecord = await CourseRepository.createVersion(
        c.orgId,
        c.id,
        updated.version,
        updated,
        "PUBLISHED",
        null,
      );

      await emitEvent({
        name: "course/published",
        orgId: c.orgId,
        actorId: "system",
        actorName: "System (Scheduled)",
        requestId: `cron-course-${c.id}`,
        timestamp: new Date().toISOString(),
        data: {
          courseId: c.id,
          slug: c.slug,
          title: c.title,
          version: updated.version,
          versionId: versionRecord.id,
        },
      });

      // Sync audit + activity parity with manual publish — null actor (scheduled/system action)
      await AuditService.write({
        orgId: c.orgId,
        action: "course.published",
        entityType: "course",
        entityId: c.id,
        newValue: {
          status: "PUBLISHED",
          version: updated.version,
          publishedAt: updated.publishedAt?.toISOString(),
        },
      });

      await ActivityFeedService.write({
        orgId: c.orgId,
        verb: "published",
        objectType: "course",
        objectId: c.id,
        objectSnapshot: { title: updated.title, slug: updated.slug, status: "PUBLISHED" },
        context: { actorName: "System (Scheduled)" },
      });

      await emitEvent({
        name: "course/status.changed",
        orgId: c.orgId,
        actorId: "system",
        actorName: "System (Scheduled)",
        requestId: `cron-course-${c.id}`,
        timestamp: new Date().toISOString(),
        data: {
          courseId: c.id,
          slug: c.slug,
          title: c.title,
          fromStatus: "SCHEDULED",
          toStatus: "PUBLISHED",
        },
      });
    }
    return due.length;
  }
}
