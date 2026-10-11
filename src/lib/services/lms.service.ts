import { prisma } from "@/lib/db/client";
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from "@/lib/utils/errors";
import { MediaRepository } from "@/lib/repositories/media.repository";
import { AuditService } from "@/lib/services/audit.service";
import type { RequestContext } from "@/types";
import type {
  CreateLmsCourseInput,
  UpdateLmsCourseInput,
  EnrollStudentInput,
  MarkProgressInput,
  SubmitAssessmentInput,
  SubmitQuizInput,
  MarkAttendanceInput,
  CreateQuestionInput,
  UpdateQuestionInput,
  ToggleBookmarkInput,
  CreateAnnouncementInput,
  IssueCertificateInput,
} from "@/lib/validations/lms.schema";

const courseTreeInclude = {
  stages: {
    orderBy: { order: "asc" as const },
    include: {
      modules: {
        orderBy: { order: "asc" as const },
        include: {
          chapters: {
            orderBy: { order: "asc" as const },
            include: {
              topics: {
                orderBy: { order: "asc" as const },
                include: {
                  contents: { orderBy: { order: "asc" as const } },
                },
              },
            },
          },
          assessments: true,
          _count: { select: { questions: true } },
        },
      },
    },
  },
  teachers: { include: { teacher: { select: { id: true, name: true, email: true } } } },
} as const;

export class LmsService {
  /** Resolve CRM Student row linked to the logged-in portal User. */
  static async resolveLinkedStudent(ctx: RequestContext) {
    const student = await prisma.student.findFirst({
      where: {
        orgId: ctx.orgId,
        userId: ctx.user.id,
        deletedAt: null,
        status: "ACTIVE",
      },
      select: {
        id: true,
        studentCode: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        status: true,
      },
    });
    if (!student) throw new NotFoundError("Student", ctx.user.id);
    return student;
  }

  static async me(ctx: RequestContext) {
    const student = await this.resolveLinkedStudent(ctx);
    const user = await prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: { avatarUrl: true },
    });
    const dashboard = await this.studentDashboard(ctx, student.id);
    return {
      student,
      user: {
        id: ctx.user.id,
        name: ctx.user.name,
        email: ctx.user.email,
        role: ctx.user.role,
        avatarUrl: user?.avatarUrl ?? null,
        phone: student.phone,
      },
      ...dashboard,
    };
  }

  static async listCourses(ctx: RequestContext) {
    if (ctx.user.role === "STUDENT") {
      const student = await this.resolveLinkedStudent(ctx);
      return prisma.lmsCourse.findMany({
        where: {
          orgId: ctx.orgId,
          isPublished: true,
          enrollments: { some: { studentId: student.id, status: "ACTIVE" } },
        },
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { enrollments: true, stages: true } },
          teachers: { include: { teacher: { select: { id: true, name: true } } } },
        },
      });
    }
    return prisma.lmsCourse.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { enrollments: true, stages: true } },
        teachers: { include: { teacher: { select: { id: true, name: true } } } },
      },
    });
  }

  static async getCourseTree(ctx: RequestContext, courseId: string) {
    const course = await prisma.lmsCourse.findFirst({
      where: { id: courseId, orgId: ctx.orgId },
      include: courseTreeInclude,
    });
    if (!course) throw new NotFoundError("LmsCourse", courseId);
    if (ctx.user.role === "STUDENT") {
      if (!course.isPublished) throw new NotFoundError("LmsCourse", courseId);
      const student = await this.resolveLinkedStudent(ctx);
      const enrollment = await prisma.lmsEnrollment.findFirst({
        where: { studentId: student.id, courseId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!enrollment) throw new ForbiddenError("read", "lms_courses");
    }
    return course;
  }

  static async createCourse(ctx: RequestContext, input: CreateLmsCourseInput) {
    const existing = await prisma.lmsCourse.findFirst({
      where: { orgId: ctx.orgId, slug: input.slug },
      select: { id: true },
    });
    if (existing) throw new ConflictError(`LMS course slug "${input.slug}" already exists`);

    return prisma.lmsCourse.create({
      data: {
        orgId: ctx.orgId,
        title: input.title,
        slug: input.slug,
        description: input.description,
        marketingCourseId: input.marketingCourseId ?? null,
        isPublished: input.isPublished ?? false,
        status: input.isPublished ? "PUBLISHED" : "DRAFT",
      },
    });
  }

  static async updateCourse(ctx: RequestContext, courseId: string, input: UpdateLmsCourseInput) {
    const course = await prisma.lmsCourse.findFirst({ where: { id: courseId, orgId: ctx.orgId } });
    if (!course) throw new NotFoundError("LmsCourse", courseId);
    return prisma.lmsCourse.update({
      where: { id: courseId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isPublished !== undefined ? { isPublished: input.isPublished, status: input.isPublished ? "PUBLISHED" : "DRAFT" } : {}),
      },
    });
  }

  static async deleteCourse(ctx: RequestContext, courseId: string) {
    const course = await prisma.lmsCourse.findFirst({ where: { id: courseId, orgId: ctx.orgId } });
    if (!course) throw new NotFoundError("LmsCourse", courseId);

    return prisma.$transaction(async (tx) => {
      const stages = await tx.lmsStage.findMany({ where: { courseId } });
      const stageIds = stages.map((s) => s.id);

      const modules = await tx.lmsModule.findMany({ where: { stageId: { in: stageIds } } });
      const moduleIds = modules.map((m) => m.id);

      const chapters = await tx.lmsChapter.findMany({ where: { moduleId: { in: moduleIds } } });
      const chapterIds = chapters.map((c) => c.id);

      const topics = await tx.lmsTopic.findMany({ where: { chapterId: { in: chapterIds } } });
      const topicIds = topics.map((t) => t.id);

      await tx.lmsContent.deleteMany({ where: { topicId: { in: topicIds } } });
      await tx.lmsTopic.deleteMany({ where: { chapterId: { in: chapterIds } } });
      await tx.lmsChapter.deleteMany({ where: { moduleId: { in: moduleIds } } });
      await tx.lmsModule.deleteMany({ where: { stageId: { in: stageIds } } });
      await tx.lmsStage.deleteMany({ where: { courseId } });

      await tx.lmsStudentProgress.deleteMany({ where: { topicId: { in: topicIds } } });

      const attSessions = await tx.lmsAttendanceSession.findMany({ where: { courseId } });
      const attSessionIds = attSessions.map((s) => s.id);
      await tx.lmsAttendanceRecord.deleteMany({ where: { sessionId: { in: attSessionIds } } });
      await tx.lmsAttendanceSession.deleteMany({ where: { courseId } });

      const assignments = await tx.lmsAssignment.findMany({ where: { courseId } });
      const assignmentIds = assignments.map((a) => a.id);
      await tx.lmsAssignmentSubmission.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
      await tx.lmsAssignment.deleteMany({ where: { courseId } });

      await tx.lmsCertificate.deleteMany({ where: { courseId } });
      await tx.lmsTimetableSlot.deleteMany({ where: { courseId } });
      await tx.lmsEnrollment.deleteMany({ where: { courseId } });

      await tx.lmsCourse.delete({ where: { id: courseId } });
    });
  }

  // ─── Stage CRUD ───────────────────────────────────────────────────────────

  static async createStage(ctx: RequestContext, courseId: string, title: string, order?: number) {
    const course = await prisma.lmsCourse.findFirst({ where: { id: courseId, orgId: ctx.orgId } });
    if (!course) throw new NotFoundError("LmsCourse", courseId);

    const nextOrder = order ?? (await prisma.lmsStage.count({ where: { courseId } }));
    return prisma.lmsStage.create({ data: { courseId, title, order: nextOrder } });
  }

  static async updateStage(ctx: RequestContext, stageId: string, data: { title?: string; order?: number }) {
    const stage = await prisma.lmsStage.findFirst({
      where: { id: stageId },
      include: { course: { select: { orgId: true } } },
    });
    if (!stage || stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsStage", stageId);
    return prisma.lmsStage.update({ where: { id: stageId }, data });
  }

  static async deleteStage(ctx: RequestContext, stageId: string) {
    const stage = await prisma.lmsStage.findFirst({
      where: { id: stageId },
      include: { course: { select: { orgId: true } } },
    });
    if (!stage || stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsStage", stageId);
    await prisma.lmsStage.delete({ where: { id: stageId } });
  }

  static async reorderStages(ctx: RequestContext, courseId: string, items: { id: string; order: number }[]) {
    const course = await prisma.lmsCourse.findFirst({ where: { id: courseId, orgId: ctx.orgId } });
    if (!course) throw new NotFoundError("LmsCourse", courseId);
    await prisma.$transaction(items.map((i) => prisma.lmsStage.update({ where: { id: i.id }, data: { order: i.order } })));
  }

  // ─── Module CRUD ──────────────────────────────────────────────────────────

  static async createModule(ctx: RequestContext, stageId: string, data: { title: string; order?: number; passPercent?: number; maxAttempts?: number }) {
    const stage = await prisma.lmsStage.findFirst({
      where: { id: stageId },
      include: { course: { select: { orgId: true } } },
    });
    if (!stage || stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsStage", stageId);
    const nextOrder = data.order ?? (await prisma.lmsModule.count({ where: { stageId } }));
    return prisma.lmsModule.create({
      data: {
        stageId,
        title: data.title,
        order: nextOrder,
        passPercent: data.passPercent ?? 70,
        maxAttempts: data.maxAttempts ?? 3,
      },
    });
  }

  static async updateModule(ctx: RequestContext, moduleId: string, data: { title?: string; passPercent?: number; maxAttempts?: number; order?: number; quizQuestionCount?: number | null; randomizeQuestions?: boolean }) {
    const mod = await prisma.lmsModule.findFirst({
      where: { id: moduleId },
      include: { stage: { include: { course: { select: { orgId: true } } } } },
    });
    if (!mod || mod.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsModule", moduleId);
    return prisma.lmsModule.update({ where: { id: moduleId }, data });
  }

  static async duplicateModule(ctx: RequestContext, moduleId: string) {
    const mod = await prisma.lmsModule.findFirst({
      where: { id: moduleId },
      include: {
        stage: { include: { course: { select: { orgId: true } } } },
        chapters: {
          orderBy: { order: "asc" },
          include: {
            topics: {
              orderBy: { order: "asc" },
              include: { contents: { orderBy: { order: "asc" } } },
            },
          },
        },
        questions: { orderBy: { order: "asc" } },
      },
    });
    if (!mod || mod.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsModule", moduleId);

    const nextOrder = await prisma.lmsModule.count({ where: { stageId: mod.stageId } });

    return prisma.$transaction(async (tx) => {
      const copy = await tx.lmsModule.create({
        data: {
          stageId: mod.stageId,
          title: `${mod.title} (Copy)`,
          order: nextOrder,
          unlockRules: mod.unlockRules as object,
          passPercent: mod.passPercent,
          maxAttempts: mod.maxAttempts,
          quizQuestionCount: mod.quizQuestionCount,
          randomizeQuestions: mod.randomizeQuestions,
        },
      });

      for (const ch of mod.chapters) {
        const newCh = await tx.lmsChapter.create({
          data: { moduleId: copy.id, title: ch.title, order: ch.order },
        });
        for (const t of ch.topics) {
          const newT = await tx.lmsTopic.create({
            data: { chapterId: newCh.id, title: t.title, order: t.order },
          });
          for (const c of t.contents) {
            await tx.lmsContent.create({
              data: {
                topicId: newT.id,
                title: c.title,
                type: c.type,
                url: c.url,
                body: c.body,
                duration: c.duration,
                order: c.order,
                metadata: c.metadata as object,
              },
            });
          }
        }
      }

      for (const q of mod.questions) {
        await tx.lmsQuestion.create({
          data: {
            moduleId: copy.id,
            stem: q.stem,
            options: q.options as object[],
            correctOptionId: q.correctOptionId,
            order: q.order,
            points: q.points,
            difficulty: q.difficulty,
            negativePoints: q.negativePoints,
          },
        });
      }

      return copy;
    });
  }

  static async reorderModules(ctx: RequestContext, stageId: string, items: { id: string; order: number }[]) {
    const stage = await prisma.lmsStage.findFirst({
      where: { id: stageId },
      include: { course: { select: { orgId: true } } },
    });
    if (!stage || stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsStage", stageId);
    await prisma.$transaction(items.map((i) => prisma.lmsModule.update({ where: { id: i.id }, data: { order: i.order } })));
  }

  static async deleteModule(ctx: RequestContext, moduleId: string) {
    const mod = await prisma.lmsModule.findFirst({
      where: { id: moduleId },
      include: { stage: { include: { course: { select: { orgId: true } } } } },
    });
    if (!mod || mod.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsModule", moduleId);
    await prisma.lmsModule.delete({ where: { id: moduleId } });
  }

  // ─── Chapter CRUD ─────────────────────────────────────────────────────────

  static async createChapter(ctx: RequestContext, moduleId: string, title: string, order?: number) {
    const mod = await prisma.lmsModule.findFirst({
      where: { id: moduleId },
      include: { stage: { include: { course: { select: { orgId: true } } } } },
    });
    if (!mod || mod.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsModule", moduleId);
    const nextOrder = order ?? (await prisma.lmsChapter.count({ where: { moduleId } }));
    return prisma.lmsChapter.create({ data: { moduleId, title, order: nextOrder } });
  }

  static async updateChapter(ctx: RequestContext, chapterId: string, data: { title?: string; order?: number }) {
    const ch = await prisma.lmsChapter.findFirst({
      where: { id: chapterId },
      include: { module: { include: { stage: { include: { course: { select: { orgId: true } } } } } } },
    });
    if (!ch || ch.module.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsChapter", chapterId);
    return prisma.lmsChapter.update({ where: { id: chapterId }, data });
  }

  static async deleteChapter(ctx: RequestContext, chapterId: string) {
    const ch = await prisma.lmsChapter.findFirst({
      where: { id: chapterId },
      include: { module: { include: { stage: { include: { course: { select: { orgId: true } } } } } } },
    });
    if (!ch || ch.module.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsChapter", chapterId);
    await prisma.lmsChapter.delete({ where: { id: chapterId } });
  }

  // ─── Topic CRUD ───────────────────────────────────────────────────────────

  static async createTopic(ctx: RequestContext, chapterId: string, title: string, order?: number) {
    const ch = await prisma.lmsChapter.findFirst({
      where: { id: chapterId },
      include: { module: { include: { stage: { include: { course: { select: { orgId: true } } } } } } },
    });
    if (!ch || ch.module.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsChapter", chapterId);
    const nextOrder = order ?? (await prisma.lmsTopic.count({ where: { chapterId } }));
    return prisma.lmsTopic.create({ data: { chapterId, title, order: nextOrder } });
  }

  static async updateTopic(ctx: RequestContext, topicId: string, data: { title?: string; order?: number; chapterId?: string }) {
    const topic = await prisma.lmsTopic.findFirst({
      where: { id: topicId },
      include: { chapter: { include: { module: { include: { stage: { include: { course: { select: { orgId: true } } } } } } } } },
    });
    if (!topic || topic.chapter.module.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsTopic", topicId);

    if (data.chapterId && data.chapterId !== topic.chapterId) {
      const target = await prisma.lmsChapter.findFirst({
        where: { id: data.chapterId },
        include: { module: { include: { stage: { include: { course: { select: { orgId: true } } } } } } },
      });
      if (!target || target.module.stage.course.orgId !== ctx.orgId) {
        throw new NotFoundError("LmsChapter", data.chapterId);
      }
      const nextOrder = data.order ?? (await prisma.lmsTopic.count({ where: { chapterId: data.chapterId } }));
      return prisma.lmsTopic.update({
        where: { id: topicId },
        data: { chapterId: data.chapterId, order: nextOrder, ...(data.title !== undefined ? { title: data.title } : {}) },
      });
    }

    return prisma.lmsTopic.update({
      where: { id: topicId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
      },
    });
  }

  static async reorderChapters(ctx: RequestContext, moduleId: string, items: { id: string; order: number }[]) {
    const mod = await prisma.lmsModule.findFirst({
      where: { id: moduleId },
      include: { stage: { include: { course: { select: { orgId: true } } } } },
    });
    if (!mod || mod.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsModule", moduleId);
    await prisma.$transaction(items.map((i) => prisma.lmsChapter.update({ where: { id: i.id }, data: { order: i.order } })));
  }

  static async reorderTopics(ctx: RequestContext, chapterId: string, items: { id: string; order: number }[]) {
    const ch = await prisma.lmsChapter.findFirst({
      where: { id: chapterId },
      include: { module: { include: { stage: { include: { course: { select: { orgId: true } } } } } } },
    });
    if (!ch || ch.module.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsChapter", chapterId);
    await prisma.$transaction(items.map((i) => prisma.lmsTopic.update({ where: { id: i.id }, data: { order: i.order } })));
  }

  static async reorderContents(ctx: RequestContext, topicId: string, items: { id: string; order: number }[]) {
    const topic = await prisma.lmsTopic.findFirst({
      where: { id: topicId },
      include: { chapter: { include: { module: { include: { stage: { include: { course: { select: { orgId: true } } } } } } } } },
    });
    if (!topic || topic.chapter.module.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsTopic", topicId);
    await prisma.$transaction(items.map((i) => prisma.lmsContent.update({ where: { id: i.id }, data: { order: i.order } })));
  }

  static async deleteTopic(ctx: RequestContext, topicId: string) {
    const topic = await prisma.lmsTopic.findFirst({
      where: { id: topicId },
      include: { chapter: { include: { module: { include: { stage: { include: { course: { select: { orgId: true } } } } } } } } },
    });
    if (!topic || topic.chapter.module.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsTopic", topicId);
    await prisma.lmsTopic.delete({ where: { id: topicId } });
  }

  // ─── Content CRUD ─────────────────────────────────────────────────────────

  static async createContent(ctx: RequestContext, topicId: string, data: { title: string; type: "PDF" | "VIDEO" | "NOTES" | "ATTACHMENT"; url: string; body?: string | null; duration?: number | null; order?: number }) {
    const topic = await prisma.lmsTopic.findFirst({
      where: { id: topicId },
      include: { chapter: { include: { module: { include: { stage: { include: { course: { select: { orgId: true } } } } } } } } },
    });
    if (!topic || topic.chapter.module.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsTopic", topicId);
    const nextOrder = data.order ?? (await prisma.lmsContent.count({ where: { topicId } }));
    const content = await prisma.lmsContent.create({
      data: {
        topicId,
        title: data.title,
        type: data.type,
        url: data.url || "#",
        body: data.body ?? null,
        duration: data.duration,
        order: nextOrder,
      },
    });
    await this.syncContentMedia(ctx, content.id, content.url);
    return content;
  }

  static async updateContent(
    ctx: RequestContext,
    contentId: string,
    data: { title?: string; type?: "PDF" | "VIDEO" | "NOTES" | "ATTACHMENT"; url?: string; body?: string | null; duration?: number | null; order?: number },
  ) {
    const content = await prisma.lmsContent.findFirst({
      where: { id: contentId },
      include: { topic: { include: { chapter: { include: { module: { include: { stage: { include: { course: { select: { orgId: true } } } } } } } } } } },
    });
    if (!content || content.topic.chapter.module.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsContent", contentId);

    const oldAssetId = this.toAssetId(content.url);
    const updated = await prisma.lmsContent.update({ where: { id: contentId }, data });

    if (data.url !== undefined && data.url !== content.url) {
      await this.syncContentMedia(ctx, contentId, updated.url, oldAssetId);
    }
    return updated;
  }

  static async deleteContent(ctx: RequestContext, contentId: string) {
    const content = await prisma.lmsContent.findFirst({
      where: { id: contentId },
      include: { topic: { include: { chapter: { include: { module: { include: { stage: { include: { course: { select: { orgId: true } } } } } } } } } } },
    });
    if (!content || content.topic.chapter.module.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsContent", contentId);
    const oldAssetId = this.toAssetId(content.url);
    await prisma.lmsContent.delete({ where: { id: contentId } });
    if (oldAssetId) {
      await MediaRepository.untrackUsage(oldAssetId, "lms_content", contentId, "url");
    }
  }

  private static UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** Returns the string only when it looks like a media asset UUID, else null. */
  private static toAssetId(url: string | null | undefined): string | null {
    if (!url) return null;
    return this.UUID_RE.test(url) ? url : null;
  }

  /** Track/untrack MediaUsage for an LmsContent url that references an org asset. */
  private static async syncContentMedia(ctx: RequestContext, contentId: string, url: string, oldAssetId?: string | null) {
    if (oldAssetId) {
      await MediaRepository.untrackUsage(oldAssetId, "lms_content", contentId, "url");
    }
    const candidate = this.toAssetId(url);
    if (!candidate) return;
    const asset = await prisma.mediaAsset.findFirst({
      where: { id: candidate, orgId: ctx.orgId, isActive: true },
      select: { id: true },
    });
    if (asset) {
      await MediaRepository.trackUsage(ctx.orgId, asset.id, "lms_content", contentId, "url");
    }
  }

  // ─── Question Bank ────────────────────────────────────────────────────────

  static async listQuestions(ctx: RequestContext, moduleId: string) {
    // The question bank contains correctOptionId/negativePoints — never expose
    // it to students; they must use getQuizForStudent (answers stripped).
    if (ctx.user.role === "STUDENT") {
      throw new ForbiddenError("read", "lms_courses");
    }
    const mod = await prisma.lmsModule.findFirst({
      where: { id: moduleId },
      include: { stage: { include: { course: { select: { orgId: true } } } } },
    });
    if (!mod || mod.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsModule", moduleId);
    return prisma.lmsQuestion.findMany({ where: { moduleId }, orderBy: { order: "asc" } });
  }

  static async createQuestion(ctx: RequestContext, input: CreateQuestionInput) {
    const mod = await prisma.lmsModule.findFirst({
      where: { id: input.moduleId },
      include: { stage: { include: { course: { select: { orgId: true } } } } },
    });
    if (!mod || mod.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsModule", input.moduleId);
    const nextOrder = input.order ?? (await prisma.lmsQuestion.count({ where: { moduleId: input.moduleId } }));
    return prisma.lmsQuestion.create({
      data: {
        moduleId: input.moduleId,
        stem: input.stem,
        options: input.options as object[],
        correctOptionId: input.correctOptionId,
        order: nextOrder,
        points: input.points ?? 1,
        difficulty: input.difficulty ?? "MEDIUM",
        negativePoints: input.negativePoints ?? 0,
      },
    });
  }

  static async bulkCreateQuestions(
    ctx: RequestContext,
    moduleId: string,
    questions: Omit<CreateQuestionInput, "moduleId">[],
  ) {
    const mod = await prisma.lmsModule.findFirst({
      where: { id: moduleId },
      include: { stage: { include: { course: { select: { orgId: true } } } } },
    });
    if (!mod || mod.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsModule", moduleId);
    const startOrder = await prisma.lmsQuestion.count({ where: { moduleId } });
    await prisma.lmsQuestion.createMany({
      data: questions.map((q, i) => ({
        moduleId,
        stem: q.stem,
        options: q.options as object[],
        correctOptionId: q.correctOptionId,
        order: q.order ?? startOrder + i,
        points: q.points ?? 1,
        difficulty: q.difficulty ?? "MEDIUM",
        negativePoints: q.negativePoints ?? 0,
      })),
    });
    return this.listQuestions(ctx, moduleId);
  }

  static async updateQuestion(ctx: RequestContext, questionId: string, input: UpdateQuestionInput) {
    const q = await prisma.lmsQuestion.findFirst({
      where: { id: questionId },
      include: { module: { include: { stage: { include: { course: { select: { orgId: true } } } } } } },
    });
    if (!q || q.module.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsQuestion", questionId);
    return prisma.lmsQuestion.update({
      where: { id: questionId },
      data: {
        ...(input.stem !== undefined ? { stem: input.stem } : {}),
        ...(input.options !== undefined ? { options: input.options as object[] } : {}),
        ...(input.correctOptionId !== undefined ? { correctOptionId: input.correctOptionId } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.points !== undefined ? { points: input.points } : {}),
        ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
        ...(input.negativePoints !== undefined ? { negativePoints: input.negativePoints } : {}),
      },
    });
  }

  static async deleteQuestion(ctx: RequestContext, questionId: string) {
    const q = await prisma.lmsQuestion.findFirst({
      where: { id: questionId },
      include: { module: { include: { stage: { include: { course: { select: { orgId: true } } } } } } },
    });
    if (!q || q.module.stage.course.orgId !== ctx.orgId) throw new NotFoundError("LmsQuestion", questionId);
    await prisma.lmsQuestion.delete({ where: { id: questionId } });
  }

  // ─── Quiz Attempt (real MCQ engine) ──────────────────────────────────────

  static async getQuizForStudent(ctx: RequestContext, studentId: string, moduleId: string) {
    await this.assertStudentAccess(ctx, studentId);
    const mod = await prisma.lmsModule.findFirst({
      where: { id: moduleId },
      include: {
        stage: { include: { course: true } },
        questions: { orderBy: { order: "asc" } },
      },
    });
    if (!mod || mod.stage.course.orgId !== ctx.orgId || !mod.stage.course.isPublished) {
      throw new NotFoundError("LmsModule", moduleId);
    }

    const enrollment = await prisma.lmsEnrollment.findFirst({
      where: { studentId, courseId: mod.stage.course.id, status: "ACTIVE" },
    });
    if (!enrollment) throw new ForbiddenError("read", "lms_courses");

    const priorAttempts = await prisma.lmsQuizAttempt.count({ where: { studentId, moduleId } });
    let pool = [...mod.questions];
    if (mod.randomizeQuestions) {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
    }
    if (mod.quizQuestionCount && mod.quizQuestionCount < pool.length) {
      pool = pool.slice(0, mod.quizQuestionCount);
    }

    return {
      module: {
        id: mod.id,
        title: mod.title,
        passPercent: mod.passPercent,
        maxAttempts: mod.maxAttempts,
        quizQuestionCount: mod.quizQuestionCount,
        randomizeQuestions: mod.randomizeQuestions,
      },
      attemptsUsed: priorAttempts,
      attemptsRemaining: Math.max(0, mod.maxAttempts - priorAttempts),
      questions: pool.map((q) => ({
        id: q.id,
        stem: q.stem,
        options: q.options,
        points: q.points,
        difficulty: q.difficulty,
        // never leak correctOptionId / negativePoints details beyond existence of negative
        hasNegativeMarking: q.negativePoints > 0,
      })),
    };
  }

  static async submitQuiz(ctx: RequestContext, studentId: string, input: SubmitQuizInput) {
    await this.assertStudentAccess(ctx, studentId);

    const mod = await prisma.lmsModule.findFirst({
      where: { id: input.moduleId },
      include: {
        stage: { include: { course: true } },
        questions: { orderBy: { order: "asc" } },
      },
    });
    if (!mod || mod.stage.course.orgId !== ctx.orgId || !mod.stage.course.isPublished) {
      throw new NotFoundError("LmsModule", input.moduleId);
    }

    const enrollment = await prisma.lmsEnrollment.findFirst({
      where: { studentId, courseId: mod.stage.course.id, status: "ACTIVE" },
    });
    if (!enrollment) throw new ForbiddenError("read", "lms_courses");

    const priorAttempts = await prisma.lmsQuizAttempt.count({
      where: { studentId, moduleId: input.moduleId },
    });

    if (priorAttempts >= mod.maxAttempts) {
      throw new ForbiddenError("quiz", `Max ${mod.maxAttempts} attempts reached for this module`);
    }

    const byId = new Map(mod.questions.map((q) => [q.id, q]));
    const selectedIds = input.questionIds?.length
      ? input.questionIds.filter((id) => byId.has(id))
      : mod.questions.map((q) => q.id);
    const questions = selectedIds.map((id) => byId.get(id)!);

    let earned = 0;
    let maxScore = 0;
    const gradedAnswers: Record<string, { given: string; correct: string; isCorrect: boolean; points: number; penalty: number }> = {};

    for (const q of questions) {
      maxScore += q.points;
      const given = input.answers[q.id] ?? "";
      const isCorrect = given === q.correctOptionId;
      let penalty = 0;
      if (isCorrect) {
        earned += q.points;
      } else if (given && q.negativePoints > 0) {
        penalty = q.negativePoints;
        earned -= penalty;
      }
      gradedAnswers[q.id] = { given, correct: q.correctOptionId, isCorrect, points: q.points, penalty };
    }

    earned = Math.max(0, earned);
    const scorePercent = maxScore > 0 ? Math.round((earned / maxScore) * 100) : 0;
    const passed = scorePercent >= mod.passPercent;

    const newStatus = passed ? "PASS" : "FAIL";

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Re-count inside the transaction so two concurrent submissions cannot
        // both pass the maxAttempts check; the unique
        // (studentId, moduleId, attemptNumber) constraint is the hard backstop.
        const currentAttempts = await tx.lmsQuizAttempt.count({
          where: { studentId, moduleId: input.moduleId },
        });
        if (currentAttempts >= mod.maxAttempts) {
          throw new ForbiddenError("quiz", `Max ${mod.maxAttempts} attempts reached for this module`);
        }

        const attemptNumber = currentAttempts + 1;

        const attempt = await tx.lmsQuizAttempt.create({
          data: {
            studentId,
            userId: ctx.user.id,
            moduleId: input.moduleId,
            answers: gradedAnswers,
            score: scorePercent,
            maxScore,
            passed,
            attemptNumber,
          },
        });

        const existingAssessment = await tx.lmsAssessment.findUnique({
          where: { studentId_moduleId: { studentId, moduleId: input.moduleId } },
        });

        if (existingAssessment) {
          await tx.lmsAssessment.update({
            where: { id: existingAssessment.id },
            data: {
              score: scorePercent,
              status: newStatus,
              attempts: attemptNumber,
              userId: ctx.user.id,
            },
          });
        } else {
          await tx.lmsAssessment.create({
            data: {
              studentId,
              userId: ctx.user.id,
              moduleId: input.moduleId,
              score: scorePercent,
              status: newStatus,
              attempts: attemptNumber,
            },
          });
        }

        return { attempt, attemptNumber };
      });

      return {
        attempt: result.attempt,
        scorePercent,
        earned,
        maxScore,
        passed,
        passPercent: mod.passPercent,
        attemptsUsed: result.attemptNumber,
        attemptsRemaining: mod.maxAttempts - result.attemptNumber,
        gradedAnswers,
      };
    } catch (err) {
      const isUniqueCollision =
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: string }).code === "P2002";
      if (isUniqueCollision) {
        throw new ConflictError("Quiz submission conflict: an attempt was recorded concurrently. Please retry.");
      }
      throw err;
    }
  }

  static async getQuizAttempts(ctx: RequestContext, studentId: string, moduleId: string) {
    await this.assertStudentAccess(ctx, studentId);
    return prisma.lmsQuizAttempt.findMany({
      where: { studentId, moduleId },
      orderBy: { createdAt: "asc" },
    });
  }

  // ─── Bookmarks ────────────────────────────────────────────────────────────

  static async toggleBookmark(ctx: RequestContext, studentId: string, input: ToggleBookmarkInput) {
    await this.assertStudentAccess(ctx, studentId);

    const existing = await prisma.lmsBookmark.findUnique({
      where: { studentId_topicId: { studentId, topicId: input.topicId } },
    });

    if (existing) {
      await prisma.lmsBookmark.delete({ where: { id: existing.id } });
      return { bookmarked: false };
    }

    await prisma.lmsBookmark.create({ data: { studentId, topicId: input.topicId } });
    return { bookmarked: true };
  }

  static async listBookmarks(ctx: RequestContext, studentId: string) {
    await this.assertStudentAccess(ctx, studentId);
    return prisma.lmsBookmark.findMany({
      where: { studentId },
      include: { topic: { select: { id: true, title: true, chapterId: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  // ─── Announcements ────────────────────────────────────────────────────────

  static async listAnnouncements(ctx: RequestContext, courseId?: string) {
    return prisma.lmsAnnouncement.findMany({
      where: {
        orgId: ctx.orgId,
        ...(courseId ? { OR: [{ courseId }, { courseId: null }] } : {}),
        publishedAt: { lte: new Date() },
      },
      orderBy: { publishedAt: "desc" },
      take: 20,
    });
  }

  static async createAnnouncement(ctx: RequestContext, input: CreateAnnouncementInput) {
    return prisma.lmsAnnouncement.create({
      data: {
        orgId: ctx.orgId,
        title: input.title,
        body: input.body,
        courseId: input.courseId ?? null,
        publishedAt: input.publishedAt ? new Date(input.publishedAt) : new Date(),
        createdBy: ctx.user.id,
      },
    });
  }

  // ─── Enrollments ──────────────────────────────────────────────────────────

  static async enroll(ctx: RequestContext, input: EnrollStudentInput) {
    const [student, course] = await Promise.all([
      prisma.student.findFirst({ where: { id: input.studentId, orgId: ctx.orgId, deletedAt: null } }),
      prisma.lmsCourse.findFirst({ where: { id: input.courseId, orgId: ctx.orgId } }),
    ]);
    if (!student) throw new NotFoundError("Student", input.studentId);
    if (!course) throw new NotFoundError("LmsCourse", input.courseId);

    try {
      return await prisma.lmsEnrollment.create({
        data: {
          orgId: ctx.orgId,
          studentId: input.studentId,
          courseId: input.courseId,
        },
      });
    } catch {
      throw new ConflictError("Student already enrolled in this LMS course");
    }
  }

  /** Soft-unenroll: sets enrollment status to DROPPED, preserving history/progress. */
  static async unenroll(ctx: RequestContext, enrollmentId: string) {
    const enrollment = await prisma.lmsEnrollment.findFirst({
      where: { id: enrollmentId, orgId: ctx.orgId },
    });
    if (!enrollment) throw new NotFoundError("LmsEnrollment", enrollmentId);
    return prisma.lmsEnrollment.update({
      where: { id: enrollmentId },
      data: { status: "DROPPED" },
    });
  }

  static async listEnrollments(ctx: RequestContext, courseId?: string) {
    // Enrollment roster includes student PII — staff-facing only. Students use
    // the self-scoped /lms/me endpoints.
    if (ctx.user.role === "STUDENT") {
      throw new ForbiddenError("read", "lms");
    }
    const teacherCourses = await this.teacherCourseIds(ctx);
    if (teacherCourses && courseId && !teacherCourses.includes(courseId)) {
      throw new ForbiddenError("read", "lms");
    }
    return prisma.lmsEnrollment.findMany({
      where: {
        orgId: ctx.orgId,
        ...(courseId ? { courseId } : teacherCourses ? { courseId: { in: teacherCourses } } : {}),
      },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, studentCode: true, email: true } },
        course: { select: { id: true, title: true, slug: true } },
      },
      orderBy: { enrolledAt: "desc" },
    });
  }

  // ─── Progress ─────────────────────────────────────────────────────────────

  static async markProgress(ctx: RequestContext, studentId: string, input: MarkProgressInput) {
    await this.assertStudentAccess(ctx, studentId);

    const topic = await prisma.lmsTopic.findFirst({
      where: { id: input.topicId },
      include: {
        chapter: {
          include: {
            module: {
              include: { stage: { include: { course: true } } },
            },
          },
        },
      },
    });
    if (!topic || topic.chapter.module.stage.course.orgId !== ctx.orgId || !topic.chapter.module.stage.course.isPublished) {
      throw new NotFoundError("LmsTopic", input.topicId);
    }

    const enrollment = await prisma.lmsEnrollment.findFirst({
      where: {
        studentId,
        courseId: topic.chapter.module.stage.course.id,
        status: "ACTIVE",
      },
    });
    if (!enrollment) throw new ForbiddenError("read", "lms_progress");

    const percent = input.percent ?? (input.completed ? 100 : 0);

    return prisma.lmsStudentProgress.upsert({
      where: { studentId_topicId: { studentId, topicId: input.topicId } },
      create: {
        studentId,
        userId: ctx.user.id,
        topicId: input.topicId,
        completed: input.completed,
        percent,
        completedAt: input.completed ? new Date() : null,
      },
      update: {
        completed: input.completed,
        percent,
        completedAt: input.completed ? new Date() : null,
        userId: ctx.user.id,
      },
    });
  }

  static async submitAssessment(ctx: RequestContext, studentId: string, input: SubmitAssessmentInput) {
    await this.assertStudentAccess(ctx, studentId);

    const lmsModule = await prisma.lmsModule.findFirst({
      where: { id: input.moduleId },
      include: { stage: { include: { course: true } } },
    });
    if (!lmsModule || lmsModule.stage.course.orgId !== ctx.orgId) {
      throw new NotFoundError("LmsModule", input.moduleId);
    }

    const existing = await prisma.lmsAssessment.findUnique({
      where: { studentId_moduleId: { studentId, moduleId: input.moduleId } },
    });

    if (existing) {
      return prisma.lmsAssessment.update({
        where: { id: existing.id },
        data: {
          score: input.score,
          status: input.status,
          attempts: existing.attempts + 1,
          userId: ctx.user.id,
        },
      });
    }

    return prisma.lmsAssessment.create({
      data: {
        studentId,
        userId: ctx.user.id,
        moduleId: input.moduleId,
        score: input.score,
        status: input.status,
      },
    });
  }

  /** PASS on module assessment unlocks next module (order+1) — state machine core */
  static async getUnlockedModuleIds(ctx: RequestContext, studentId: string, courseId: string) {
    const course = await this.getCourseTree(ctx, courseId);
    const assessments = await prisma.lmsAssessment.findMany({
      where: { studentId, status: "PASS", module: { stage: { courseId } } },
      select: { moduleId: true },
    });
    const passed = new Set(assessments.map((a) => a.moduleId));

    const unlocked: string[] = [];
    for (const stage of course.stages) {
      for (let i = 0; i < stage.modules.length; i++) {
        const mod = stage.modules[i];
        if (!mod) continue;
        if (i === 0) {
          unlocked.push(mod.id);
          continue;
        }
        const prev = stage.modules[i - 1];
        if (prev && passed.has(prev.id)) unlocked.push(mod.id);
      }
    }
    return unlocked;
  }

  // ─── Attendance ───────────────────────────────────────────────────────────

  /**
   * Courses a TEACHER is assigned to (course teacher, batch teacher, or the
   * teacher on a timetable slot). `null` means the caller is not a teacher and
   * is not narrowed beyond org scope.
   */
  static async teacherCourseIds(ctx: RequestContext): Promise<string[] | null> {
    if (ctx.user.role !== "TEACHER") return null;
    const [courseLinks, batchLinks, slots] = await Promise.all([
      prisma.lmsCourseTeacher.findMany({
        where: { teacherId: ctx.user.id, course: { orgId: ctx.orgId } },
        select: { courseId: true },
      }),
      prisma.lmsBatchTeacher.findMany({
        where: { teacherId: ctx.user.id, batch: { orgId: ctx.orgId } },
        select: { batch: { select: { courseId: true } } },
      }),
      prisma.lmsTimetableSlot.findMany({
        where: { teacherId: ctx.user.id, orgId: ctx.orgId },
        select: { courseId: true, batch: { select: { courseId: true } } },
      }),
    ]);
    const ids = new Set<string>();
    for (const l of courseLinks) ids.add(l.courseId);
    for (const l of batchLinks) ids.add(l.batch.courseId);
    for (const s of slots) ids.add(s.courseId ?? s.batch.courseId);
    return [...ids];
  }

  /** Teachers may only read or mark attendance for courses they are assigned to. */
  static async assertAttendanceCourseAccess(ctx: RequestContext, courseId: string, action: "read" | "write") {
    const allowed = await this.teacherCourseIds(ctx);
    if (allowed && !allowed.includes(courseId)) {
      throw new ForbiddenError(action, "lms_attendance");
    }
  }

  /** Courses the caller can take attendance for (teachers: assigned only). */
  static async listAttendanceCourses(ctx: RequestContext) {
    const allowed = await this.teacherCourseIds(ctx);
    return prisma.lmsCourse.findMany({
      where: { orgId: ctx.orgId, ...(allowed ? { id: { in: allowed } } : {}) },
      orderBy: { title: "asc" },
      select: { id: true, title: true, slug: true },
    });
  }

  private static async assertOrgStudents(ctx: RequestContext, studentIds: string[]) {
    if (studentIds.length === 0) return;
    const unique = [...new Set(studentIds)];
    const students = await prisma.student.findMany({
      where: { id: { in: unique }, orgId: ctx.orgId, deletedAt: null },
      select: { id: true },
    });
    if (students.length !== unique.length) {
      throw new ValidationError([{ message: "One or more student ids do not belong to this organization" }]);
    }
  }

  static async markAttendance(ctx: RequestContext, input: MarkAttendanceInput) {
    const course = await prisma.lmsCourse.findFirst({
      where: { id: input.courseId, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!course) throw new NotFoundError("LmsCourse", input.courseId);
    await this.assertAttendanceCourseAccess(ctx, input.courseId, "write");

    if (input.batchId) {
      const batch = await prisma.lmsBatch.findFirst({
        where: { id: input.batchId, orgId: ctx.orgId, courseId: input.courseId },
        select: { id: true },
      });
      if (!batch) throw new NotFoundError("LmsBatch", input.batchId);
    }

    // Dedupe student ids (LmsAttendanceRecord has @@unique([sessionId, studentId])
    // — a duplicate in one payload would otherwise surface as a raw P2002).
    const seen = new Set<string>();
    const deduped: MarkAttendanceInput["records"] = [];
    for (const r of input.records) {
      if (seen.has(r.studentId)) continue;
      seen.add(r.studentId);
      deduped.push(r);
    }

    // Every record must reference a real, non-deleted student in this org —
    // never trust client-supplied student ids.
    const studentIds = [...seen];
    const students = await prisma.student.findMany({
      where: { id: { in: studentIds }, orgId: ctx.orgId, deletedAt: null },
      select: { id: true },
    });
    if (students.length !== studentIds.length) {
      throw new ValidationError([{ message: "One or more student ids do not belong to this organization" }]);
    }

    return prisma.$transaction(async (tx) => {
      const session = await tx.lmsAttendanceSession.create({
        data: {
          orgId: ctx.orgId,
          courseId: input.courseId,
          batchId: input.batchId || null,
          timetableSlotId: input.timetableSlotId || null,
          subjectTag: input.subjectTag || null,
          title: input.title,
          heldAt: input.heldAt ? new Date(input.heldAt) : new Date(),
        },
      });

      await tx.lmsAttendanceRecord.createMany({
        data: deduped.map((r) => ({
          sessionId: session.id,
          studentId: r.studentId,
          status: r.status,
          notes: r.notes,
          markedBy: ctx.user.id,
        })),
      });

      return tx.lmsAttendanceSession.findUnique({
        where: { id: session.id },
        include: { records: true },
      });
    });
  }

  static async updateAttendanceSession(
    ctx: RequestContext,
    id: string,
    input: {
      title?: string;
      subjectTag?: string | null;
      heldAt?: string;
      records?: { studentId: string; status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED"; notes?: string | null }[];
    },
  ) {
    const session = await prisma.lmsAttendanceSession.findFirst({
      where: { id, orgId: ctx.orgId },
    });
    if (!session) throw new NotFoundError("LmsAttendanceSession", id);
    await this.assertAttendanceCourseAccess(ctx, session.courseId, "write");
    if (input.records) await this.assertOrgStudents(ctx, input.records.map((r) => r.studentId));

    return prisma.$transaction(async (tx) => {
      await tx.lmsAttendanceSession.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.subjectTag !== undefined ? { subjectTag: input.subjectTag } : {}),
          ...(input.heldAt !== undefined ? { heldAt: new Date(input.heldAt) } : {}),
        },
      });

      if (input.records) {
        for (const record of input.records) {
          await tx.lmsAttendanceRecord.upsert({
            where: {
              sessionId_studentId: {
                sessionId: id,
                studentId: record.studentId,
              },
            },
            update: {
              status: record.status,
              notes: record.notes ?? null,
              markedBy: ctx.user.id,
            },
            create: {
              sessionId: id,
              studentId: record.studentId,
              status: record.status,
              notes: record.notes ?? null,
              markedBy: ctx.user.id,
            },
          });
        }
      }

      return tx.lmsAttendanceSession.findUnique({
        where: { id },
        include: { records: true },
      });
    });
  }

  static async deleteAttendanceSession(ctx: RequestContext, id: string) {
    const session = await prisma.lmsAttendanceSession.findFirst({
      where: { id, orgId: ctx.orgId },
    });
    if (!session) throw new NotFoundError("LmsAttendanceSession", id);
    await this.assertAttendanceCourseAccess(ctx, session.courseId, "write");

    await prisma.lmsAttendanceRecord.deleteMany({ where: { sessionId: id } });
    await prisma.lmsAttendanceSession.delete({ where: { id } });
  }

  static async getAttendanceForCourse(
    ctx: RequestContext,
    courseId: string,
    opts: { batchId?: string; from?: string; to?: string } = {},
  ) {
    const course = await prisma.lmsCourse.findFirst({ where: { id: courseId, orgId: ctx.orgId } });
    if (!course) throw new NotFoundError("LmsCourse", courseId);
    await this.assertAttendanceCourseAccess(ctx, courseId, "read");

    const from = opts.from ? new Date(opts.from) : undefined;
    const to = opts.to ? new Date(opts.to) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      throw new ValidationError([{ message: "Invalid date range" }]);
    }
    if (from && to && from > to) {
      throw new ValidationError([{ message: "Start date must be on or before the end date" }]);
    }

    const sessions = await prisma.lmsAttendanceSession.findMany({
      where: {
        orgId: ctx.orgId,
        courseId,
        ...(opts.batchId ? { batchId: opts.batchId } : {}),
        ...(opts.from || opts.to
          ? {
              heldAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: { heldAt: "desc" },
      include: {
        batch: { select: { id: true, name: true, type: true } },
        records: {
          include: {
            student: { select: { id: true, firstName: true, lastName: true, studentCode: true } },
          },
        },
      },
    });
    return sessions;
  }

  static async getStudentAttendanceSummary(ctx: RequestContext, studentId: string, courseId?: string) {
    await this.assertStudentAccess(ctx, studentId);
    const where = { studentId, ...(courseId ? { session: { courseId } } : { session: { org: { id: ctx.orgId } } }) };
    const records = await prisma.lmsAttendanceRecord.findMany({
      where,
      include: { session: { select: { title: true, heldAt: true, courseId: true } } },
      orderBy: { markedAt: "desc" },
    });
    const total = records.length;
    const present = records.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
    const attendancePercent = total > 0 ? Math.round((present / total) * 100) : 0;
    return { records, total, present, attendancePercent };
  }

  // ─── Certificates ─────────────────────────────────────────────────────────

  static async listCertificates(ctx: RequestContext, studentId?: string) {
    // A STUDENT may only list their own certificates; the ?studentId= filter is
    // always overridden to the linked student (never trust a client-supplied id).
    if (ctx.user.role === "STUDENT") {
      const student = await this.resolveLinkedStudent(ctx);
      studentId = student.id;
    }
    return prisma.lmsCertificate.findMany({
      where: {
        orgId: ctx.orgId,
        ...(studentId ? { studentId } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        course: { select: { id: true, title: true, slug: true } },
        student: { select: { id: true, firstName: true, lastName: true, studentCode: true } },
      },
    });
  }

  /**
   * Single certificate for viewing. Org-scoped for staff; a STUDENT only ever
   * resolves their own ISSUED certificate (anything else is a 404, not a 403,
   * so ids of other students' certificates are not confirmed).
   */
  static async getCertificate(ctx: RequestContext, id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new NotFoundError("LmsCertificate", id);
    }
    const cert = await prisma.lmsCertificate.findFirst({
      where: { id, orgId: ctx.orgId },
      include: {
        course: { select: { id: true, title: true, slug: true } },
        student: { select: { id: true, firstName: true, lastName: true, studentCode: true } },
        org: { select: { name: true } },
        issuer: { select: { name: true } },
      },
    });
    if (!cert) throw new NotFoundError("LmsCertificate", id);
    if (ctx.user.role === "STUDENT") {
      const student = await this.resolveLinkedStudent(ctx);
      if (cert.studentId !== student.id || cert.status !== "ISSUED") {
        throw new NotFoundError("LmsCertificate", id);
      }
    }
    return cert;
  }

  // Certificate numbers are server-owned identity. Generated on the server and
  // regenerated on unique-constraint collision so a P2002 never surfaces.
  private static generateCertificateNo(): string {
    const now = new Date();
    const seq = String(Math.floor(Math.random() * 90000) + 10000);
    return `ABC-${now.getFullYear()}-${seq}`;
  }

  static async issueCertificate(ctx: RequestContext, input: IssueCertificateInput) {
    const [student, course] = await Promise.all([
      prisma.student.findFirst({ where: { id: input.studentId, orgId: ctx.orgId, deletedAt: null } }),
      prisma.lmsCourse.findFirst({ where: { id: input.courseId, orgId: ctx.orgId } }),
    ]);
    if (!student) throw new NotFoundError("Student", input.studentId);
    if (!course) throw new NotFoundError("LmsCourse", input.courseId);

    const include = {
      course: { select: { title: true } },
      student: { select: { firstName: true, lastName: true, studentCode: true } },
    };

    const isP2002 = (err: unknown) =>
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";

    // A caller-supplied verification code is fixed — it cannot be silently
    // regenerated, so a (orgId, verificationCode) collision is a hard conflict.
    if (input.verificationCode) {
      try {
        return await prisma.lmsCertificate.create({
          data: {
            orgId: ctx.orgId,
            studentId: input.studentId,
            courseId: input.courseId,
            certificateNo: this.generateCertificateNo(),
            verificationCode: input.verificationCode,
            title: input.title,
            status: "ISSUED",
            issuedAt: new Date(),
            issuedBy: ctx.user.id,
            fileUrl: input.fileUrl,
          },
          include,
        });
      } catch (err) {
        if (isP2002(err)) {
          throw new ConflictError(`Verification code "${input.verificationCode}" is already in use for this organization`);
        }
        throw err;
      }
    }

    // Server-generated identity. certificateNo is a short display number; the
    // verificationCode is an unpredictable UUID so codes cannot be enumerated
    // or guessed. Both are regenerated on P2002 collision (rare).
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await prisma.lmsCertificate.create({
          data: {
            orgId: ctx.orgId,
            studentId: input.studentId,
            courseId: input.courseId,
            certificateNo: this.generateCertificateNo(),
            verificationCode: crypto.randomUUID(),
            title: input.title,
            status: "ISSUED",
            issuedAt: new Date(),
            issuedBy: ctx.user.id,
            fileUrl: input.fileUrl,
          },
          include,
        });
      } catch (err) {
        if (!isP2002(err)) throw err;
        if (attempt === 4) {
          throw new ConflictError("Could not allocate a unique certificate number. Please retry.");
        }
      }
    }

    throw new ConflictError("Could not allocate a unique certificate number. Please retry.");
  }

  static async verifyCertificate(certificateNo: string) {
    return prisma.lmsCertificate.findFirst({
      where: {
        // Only the unpredictable verificationCode may authenticate a
        // certificate. certificateNo is display-only and must never be usable
        // to enumerate or probe certificates.
        verificationCode: certificateNo,
        status: "ISSUED",
      },
      include: {
        course: { select: { title: true } },
        student: { select: { firstName: true, lastName: true } },
        org: { select: { name: true } },
      },
    });
  }

  // Revoke an issued certificate. Transition-only: ISSUED -> REVOKED. The row
  // is preserved (audit trail, verification history) and verification is
  // disabled for revoked certificates (verifyCertificate filters status=ISSUED).
  static async revokeCertificate(ctx: RequestContext, id: string) {
    const cert = await prisma.lmsCertificate.findFirst({
      where: { id, orgId: ctx.orgId },
    });
    if (!cert) throw new NotFoundError("LmsCertificate", id);

    if (cert.status === "REVOKED") {
      throw new ConflictError("Certificate is already revoked");
    }
    if (cert.status !== "ISSUED") {
      throw new ValidationError([{ message: "Only issued certificates can be revoked" }]);
    }

    const updated = await prisma.lmsCertificate.update({
      where: { id },
      data: { status: "REVOKED" },
      include: {
        course: { select: { id: true, title: true, slug: true } },
        student: { select: { id: true, firstName: true, lastName: true, studentCode: true } },
      },
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "lms.certificate_revoked",
      entityType: "lms_certificate",
      entityId: id,
      oldValue: { status: cert.status, certificateNo: cert.certificateNo },
      newValue: { status: "REVOKED" },
    });

    return updated;
  }

  // Hard-delete a certificate (org-scoped). Used for DRAFT rows or cleanup.
  static async deleteCertificate(ctx: RequestContext, id: string) {
    const cert = await prisma.lmsCertificate.findFirst({
      where: { id, orgId: ctx.orgId },
    });
    if (!cert) throw new NotFoundError("LmsCertificate", id);

    await prisma.lmsCertificate.delete({ where: { id } });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "lms.certificate_deleted",
      entityType: "lms_certificate",
      entityId: id,
      oldValue: { status: cert.status, certificateNo: cert.certificateNo, title: cert.title },
      newValue: null,
    });
  }

  // ─── Student Dashboard ────────────────────────────────────────────────────

  static async studentDashboard(ctx: RequestContext, studentId: string) {
    await this.assertStudentAccess(ctx, studentId);

    const [enrollments, progress, assessments, certificates, attendance, announcements, bookmarks, quizAttempts] = await Promise.all([
      prisma.lmsEnrollment.findMany({
        where: { studentId, orgId: ctx.orgId },
        include: { course: { select: { id: true, title: true, slug: true, isPublished: true } } },
        orderBy: { enrolledAt: "asc" },
      }),
      prisma.lmsStudentProgress.findMany({ where: { studentId } }),
      prisma.lmsAssessment.findMany({
        where: { studentId },
        include: {
          module: {
            select: {
              id: true, title: true, maxAttempts: true, passPercent: true,
              stage: { select: { courseId: true } },
            },
          },
        },
      }),
      prisma.lmsCertificate.findMany({
        where: { studentId, orgId: ctx.orgId, status: "ISSUED" },
        include: { course: { select: { title: true } } },
      }),
      prisma.lmsAttendanceRecord.findMany({
        where: { studentId },
        orderBy: { markedAt: "desc" },
        take: 20,
        include: { session: { select: { title: true, heldAt: true, courseId: true } } },
      }),
      prisma.lmsAnnouncement.findMany({
        where: { orgId: ctx.orgId, publishedAt: { lte: new Date() } },
        orderBy: { publishedAt: "desc" },
        take: 5,
      }),
      prisma.lmsBookmark.findMany({
        where: { studentId },
        include: { topic: { select: { id: true, title: true } } },
        take: 10,
        orderBy: { createdAt: "desc" },
      }),
      prisma.lmsQuizAttempt.findMany({ where: { studentId }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);

    // Compute attendance %
    const presentCount = attendance.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
    const attendancePercent = attendance.length > 0 ? Math.round((presentCount / attendance.length) * 100) : 0;

    // Compute overall completed topics
    const completedTopics = progress.filter((p) => p.completed).length;

    // Per-enrollment percentComplete — one batched query for all enrolled courses
    const enrolledCourseIds = enrollments.map((e) => e.courseId);
    const topicsForCourses = enrolledCourseIds.length > 0
      ? await prisma.lmsTopic.findMany({
          where: { chapter: { module: { stage: { courseId: { in: enrolledCourseIds } } } } },
          select: { id: true, chapter: { select: { module: { select: { stage: { select: { courseId: true } } } } } } },
        })
      : [];

    // Build courseId → topicId[] map
    const courseTopicsMap = new Map<string, string[]>();
    for (const t of topicsForCourses) {
      const cId = t.chapter.module.stage.courseId;
      const arr = courseTopicsMap.get(cId) ?? [];
      arr.push(t.id);
      courseTopicsMap.set(cId, arr);
    }

    // Build topicId → completed map
    const progressCompletedMap = new Map(progress.map((p) => [p.topicId, p.completed]));

    const enrollmentsWithPercent = enrollments.map((e) => {
      const topicIds = courseTopicsMap.get(e.courseId) ?? [];
      const doneCount = topicIds.filter((id) => progressCompletedMap.get(id) === true).length;
      const percentComplete = topicIds.length > 0 ? Math.round((doneCount / topicIds.length) * 100) : 0;
      return { ...e, percentComplete };
    });

    // Prefer in-progress course; else first incomplete; else first enrollment
    const resumeTarget =
      enrollmentsWithPercent.find((e) => e.percentComplete > 0 && e.percentComplete < 100) ??
      enrollmentsWithPercent.find((e) => e.percentComplete < 100) ??
      enrollmentsWithPercent[0];
    const continueLearning = resumeTarget
      ? {
          courseId: resumeTarget.courseId,
          courseTitle: resumeTarget.course.title,
          percentComplete: resumeTarget.percentComplete,
        }
      : null;

    return {
      enrollments: enrollmentsWithPercent,
      progress,
      assessments,
      certificates,
      attendance,
      attendancePercent,
      completedTopics,
      announcements,
      bookmarks,
      quizAttempts,
      continueLearning,
    };
  }

  /** Staff: create STUDENT User + link to CRM Student for portal login. */
  static async provisionPortalAccess(
    ctx: RequestContext,
    input: { studentId: string; password: string },
  ) {
    const student = await prisma.student.findFirst({
      where: { id: input.studentId, orgId: ctx.orgId, deletedAt: null },
    });
    if (!student) throw new NotFoundError("Student", input.studentId);
    if (student.userId) throw new ConflictError("Portal access already provisioned for this student");

    const existingUser = await prisma.user.findFirst({
      where: { orgId: ctx.orgId, email: student.email, deletedAt: null },
    });
    if (existingUser) {
      if (existingUser.role !== "STUDENT") {
        throw new ConflictError("Email already belongs to a non-student user");
      }
      await prisma.student.update({
        where: { id: student.id },
        data: { userId: existingUser.id },
      });
      await AuditService.write({
        orgId: ctx.orgId,
        userId: ctx.user.id,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        action: "lms.portal_access_linked",
        entityType: "student",
        entityId: student.id,
        newValue: { userId: existingUser.id, email: student.email, linkedExisting: true },
      });
      return { userId: existingUser.id, studentId: student.id, email: student.email, linkedExisting: true };
    }

    const { hash } = await import("argon2");
    const passwordHash = await hash(input.password);
    const user = await prisma.user.create({
      data: {
        orgId: ctx.orgId,
        campusId: student.campusId,
        name: `${student.firstName} ${student.lastName}`,
        email: student.email,
        phone: student.phone,
        passwordHash,
        role: "STUDENT",
        isActive: true,
      },
    });
    await prisma.student.update({
      where: { id: student.id },
      data: { userId: user.id },
    });
    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "lms.portal_access_provisioned",
      entityType: "student",
      entityId: student.id,
      newValue: { userId: user.id, email: student.email, linkedExisting: false },
    });
    return { userId: user.id, studentId: student.id, email: student.email, linkedExisting: false };
  }

  static async getMyCoursePlayer(ctx: RequestContext, courseId: string) {
    const student = await this.resolveLinkedStudent(ctx);
    const enrollment = await prisma.lmsEnrollment.findFirst({
      where: { studentId: student.id, courseId, orgId: ctx.orgId, status: "ACTIVE" },
    });
    if (!enrollment) throw new ForbiddenError("read", "lms_courses");

    const [course, progress, assessments, unlockedModuleIds, bookmarks, quizAttempts] = await Promise.all([
      this.getCourseTree(ctx, courseId),
      prisma.lmsStudentProgress.findMany({ where: { studentId: student.id } }),
      prisma.lmsAssessment.findMany({ where: { studentId: student.id } }),
      this.getUnlockedModuleIds(ctx, student.id, courseId),
      prisma.lmsBookmark.findMany({ where: { studentId: student.id }, select: { topicId: true } }),
      prisma.lmsQuizAttempt.findMany({ where: { studentId: student.id, module: { stage: { courseId } } }, orderBy: { createdAt: "asc" } }),
    ]);

    return {
      student,
      enrollment,
      course,
      progress,
      assessments,
      unlockedModuleIds,
      bookmarkedTopicIds: bookmarks.map((b) => b.topicId),
      quizAttempts,
    };
  }

  static async getModuleQuestions(ctx: RequestContext, studentId: string, moduleId: string) {
    return this.getQuizForStudent(ctx, studentId, moduleId);
  }

  private static async assertStudentAccess(ctx: RequestContext, studentId: string) {
    if (ctx.user.role === "STUDENT") {
      const linked = await prisma.student.findFirst({
        where: { id: studentId, orgId: ctx.orgId, userId: ctx.user.id, deletedAt: null },
        select: { id: true },
      });
      if (!linked) throw new ForbiddenError("read", "lms");
      return;
    }

    const student = await prisma.student.findFirst({
      where: { id: studentId, orgId: ctx.orgId, deletedAt: null },
      select: { id: true },
    });
    if (!student) throw new NotFoundError("Student", studentId);
  }
}
