import { z } from "zod";
import { BATCH_FREQUENCIES, scheduleError } from "@/lib/lms/batch-schedule";

export const createLmsCourseSchema = z.object({
  title: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().optional(),
  marketingCourseId: z.string().uuid().optional().nullable(),
  isPublished: z.boolean().optional(),
});

export const updateLmsCourseSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  isPublished: z.boolean().optional(),
});

export const createLmsStageSchema = z.object({
  title: z.string().min(1).max(255),
  order: z.number().int().min(0).optional(),
});

export const createLmsModuleSchema = z.object({
  title: z.string().min(1).max(255),
  order: z.number().int().min(0).optional(),
  unlockRules: z.record(z.unknown()).optional(),
  passPercent: z.number().int().min(0).max(100).optional(),
  maxAttempts: z.number().int().min(1).optional(),
  quizQuestionCount: z.number().int().min(1).nullable().optional(),
  randomizeQuestions: z.boolean().optional(),
});

export const updateLmsModuleSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  passPercent: z.number().int().min(0).max(100).optional(),
  maxAttempts: z.number().int().min(1).optional(),
  quizQuestionCount: z.number().int().min(1).nullable().optional(),
  randomizeQuestions: z.boolean().optional(),
});

export const createLmsChapterSchema = z.object({
  title: z.string().min(1).max(255),
  order: z.number().int().min(0).optional(),
});

export const createLmsTopicSchema = z.object({
  title: z.string().min(1).max(255),
  order: z.number().int().min(0).optional(),
});

export const updateLmsTopicSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  order: z.number().int().min(0).optional(),
  chapterId: z.string().uuid().optional(),
});

export const createLmsContentSchema = z.object({
  title: z.string().min(1).max(255),
  type: z.enum(["PDF", "VIDEO", "NOTES", "ATTACHMENT"]),
  url: z.string().min(1).optional().default("#"),
  body: z.string().optional().nullable(),
  duration: z.number().int().positive().optional().nullable(),
  order: z.number().int().min(0).optional(),
});

export const updateLmsContentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  type: z.enum(["PDF", "VIDEO", "NOTES", "ATTACHMENT"]).optional(),
  url: z.string().min(1).optional(),
  body: z.string().optional().nullable(),
  duration: z.number().int().positive().optional().nullable(),
  order: z.number().int().min(0).optional(),
});

export const reorderSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), order: z.number().int().min(0) })),
});

export const enrollStudentSchema = z.object({
  studentId: z.string().uuid(),
  courseId: z.string().uuid(),
  batchId: z.string().uuid().optional().nullable(),
});

export const markProgressSchema = z.object({
  topicId: z.string().uuid(),
  completed: z.boolean(),
  percent: z.number().int().min(0).max(100).optional(),
});

export const submitAssessmentSchema = z.object({
  moduleId: z.string().uuid(),
  score: z.number().int().min(0).max(100),
  status: z.enum(["PASS", "FAIL", "PENDING"]),
});

export const submitQuizSchema = z.object({
  moduleId: z.string().uuid(),
  answers: z.record(z.string()),
  questionIds: z.array(z.string().uuid()).optional(),
});

export const markAttendanceSchema = z.object({
  courseId: z.string().uuid(),
  batchId: z.string().uuid().optional().nullable(),
  timetableSlotId: z.string().uuid().optional().nullable(),
  subjectTag: z.string().max(100).optional().nullable(),
  title: z.string().min(1).max(255),
  heldAt: z.string().datetime().optional(),
  records: z.array(
    z.object({
      studentId: z.string().uuid(),
      status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]),
      notes: z.string().optional(),
    }),
  ).min(1),
});

export const createQuestionSchema = z.object({
  moduleId: z.string().uuid(),
  stem: z.string().min(1).max(5000),
  options: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })).min(2).max(6),
  correctOptionId: z.string().min(1),
  order: z.number().int().min(0).optional(),
  points: z.number().int().min(1).optional(),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional(),
  negativePoints: z.number().int().min(0).optional(),
});

export const updateQuestionSchema = createQuestionSchema.partial().omit({ moduleId: true });

export const bulkQuestionsSchema = z.object({
  moduleId: z.string().uuid(),
  questions: z.array(createQuestionSchema.omit({ moduleId: true })).min(1).max(200),
});

export const toggleBookmarkSchema = z.object({
  topicId: z.string().uuid(),
});

export const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().min(1),
  courseId: z.string().uuid().optional().nullable(),
  publishedAt: z.string().datetime().optional().nullable(),
});

export const issueCertificateSchema = z.object({
  studentId: z.string().uuid(),
  courseId: z.string().uuid(),
  title: z.string().min(1).max(255),
  // certificateNo is server-generated — never trusted from the client. Kept
  // optional so legacy callers that still send it do not 400; the value is
  // ignored by issueCertificate.
  certificateNo: z.string().min(1).max(100).optional(),
  verificationCode: z.string().max(100).optional(),
  fileUrl: z.string().optional(),
});

export { BATCH_FREQUENCIES };

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM (24h)");

export const batchScheduleSchema = z
  .object({
    frequency: z.enum(BATCH_FREQUENCIES).optional().nullable(),
    startTime: timeOfDay.optional().nullable(),
    endTime: timeOfDay.optional().nullable(),
  })
  .superRefine((s, ctx) => {
    const error = scheduleError({ startTime: s.startTime, endTime: s.endTime });
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error, path: ["endTime"] });
  });

const batchBase = z.object({
  courseId: z.string().uuid(),
  name: z.string().min(1).max(255),
  type: z.enum(["MORNING", "EVENING", "WEEKEND", "CUSTOM"]).optional(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  capacity: z.number().int().positive().optional().nullable(),
  schedule: batchScheduleSchema.optional(),
});

export const createBatchSchema = batchBase.superRefine((b, ctx) => {
  const error = scheduleError({ startDate: b.startDate, endDate: b.endDate });
  if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error, path: ["endDate"] });
});

// Date order against the stored batch is re-checked in LmsOpsService.updateBatch.
export const updateBatchSchema = batchBase
  .partial()
  .omit({ courseId: true })
  .superRefine((b, ctx) => {
    if (!b.startDate || !b.endDate) return;
    const error = scheduleError({ startDate: b.startDate, endDate: b.endDate });
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error, path: ["endDate"] });
  });

export const batchMembersSchema = z.object({
  studentIds: z.array(z.string().uuid()).optional(),
  teacherIds: z.array(z.string().uuid()).optional(),
});

export const createTimetableSlotSchema = z.object({
  batchId: z.string().uuid(),
  courseId: z.string().uuid().optional().nullable(),
  teacherId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(255),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  room: z.string().max(100).optional().nullable(),
  onlineUrl: z.union([z.string().url(), z.literal("")]).optional().nullable(),
  subjectTag: z.string().max(100).optional().nullable(),
});

export const updateTimetableSlotSchema = createTimetableSlotSchema.partial().omit({ batchId: true });

export const createAssignmentSchema = z.object({
  courseId: z.string().uuid(),
  batchId: z.string().uuid().optional().nullable(),
  moduleId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  maxScore: z.number().int().min(1).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "CLOSED"]).optional(),
});

export const updateAssignmentSchema = createAssignmentSchema.partial().omit({ courseId: true });

export const submitAssignmentSchema = z.object({
  assignmentId: z.string().uuid(),
  fileUrl: z.string().optional().nullable(),
  body: z.string().optional().nullable(),
});

export const gradeSubmissionSchema = z.object({
  score: z.number().int().min(0),
  feedback: z.string().optional().nullable(),
  status: z.enum(["GRADED", "RETURNED"]).optional(),
});

export const assignCourseTeacherSchema = z.object({
  courseId: z.string().uuid(),
  teacherId: z.string().uuid(),
});

export const bulkCurriculumImportSchema = z.object({
  stages: z.array(
    z.object({
      title: z.string().min(1),
      modules: z.array(
        z.object({
          title: z.string().min(1),
          chapters: z.array(
            z.object({
              title: z.string().min(1),
              topics: z.array(
                z.object({
                  title: z.string().min(1),
                  contents: z.array(
                    z.object({
                      title: z.string().min(1),
                      type: z.enum(["PDF", "VIDEO", "NOTES", "ATTACHMENT"]),
                      url: z.string().optional().default("#"),
                      body: z.string().optional(),
                    }),
                  ).optional(),
                }),
              ).optional(),
            }),
          ).optional(),
        }),
      ).optional(),
    }),
  ).min(1),
});

export type CreateLmsCourseInput = z.infer<typeof createLmsCourseSchema>;
export type UpdateLmsCourseInput = z.infer<typeof updateLmsCourseSchema>;
export type EnrollStudentInput = z.infer<typeof enrollStudentSchema>;
export type MarkProgressInput = z.infer<typeof markProgressSchema>;
export type SubmitAssessmentInput = z.infer<typeof submitAssessmentSchema>;
export type SubmitQuizInput = z.infer<typeof submitQuizSchema>;
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
export type ToggleBookmarkInput = z.infer<typeof toggleBookmarkSchema>;
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type IssueCertificateInput = z.infer<typeof issueCertificateSchema>;
export type CreateBatchInput = z.infer<typeof createBatchSchema>;
export type UpdateBatchInput = z.infer<typeof updateBatchSchema>;
export type CreateTimetableSlotInput = z.infer<typeof createTimetableSlotSchema>;
export type UpdateTimetableSlotInput = z.infer<typeof updateTimetableSlotSchema>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;
export type BulkCurriculumImportInput = z.infer<typeof bulkCurriculumImportSchema>;
