import { z } from "zod";

export const jobStatusValues = ["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"] as const;

export const jobApplicationStatusValues = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "SHORTLISTED",
  "INTERVIEW_SCHEDULED",
  "SELECTED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export const JOB_STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["CLOSED", "DRAFT", "ARCHIVED"],
  CLOSED: ["PUBLISHED", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

export const createJobSchema = z.object({
  title: z.string().min(1).max(255),
  slug: z.string().max(255).regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens").optional(),
  hiringPartnerId: z.string().uuid().optional(),
  description: z.string().max(20000).optional(),
  requirements: z.string().max(10000).optional(),
  location: z.string().max(255).optional(),
  isRemote: z.boolean().default(false),
  jobType: z.enum(["full_time", "part_time", "contract", "internship"]).default("full_time"),
  salaryMin: z.number().positive().optional(),
  salaryMax: z.number().positive().optional(),
  currency: z.string().length(3).default("INR"),
  experienceYears: z.number().int().min(0).optional(),
  closesAt: z.string().datetime().optional(),
  tags: z.array(z.string().max(50)).default([]),
  courseIds: z.array(z.string().uuid()).default([]),
  seoTitle: z.string().max(255).optional(),
  seoDesc: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const updateJobSchema = createJobSchema.partial();

export const publishJobSchema = z.object({
  status: z.enum(jobStatusValues),
});

export const jobFiltersSchema = z.object({
  search: z.string().optional(),
  status: z.enum(jobStatusValues).optional(),
  hiringPartnerId: z.string().uuid().optional(),
  jobType: z.enum(["full_time", "part_time", "contract", "internship"]).optional(),
  isRemote: z.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "updatedAt", "title", "publishedAt", "closesAt"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export const createJobApplicationSchema = z.object({
  jobId: z.string().uuid(),
  studentId: z.string().uuid().optional(),
  applicantName: z.string().min(1).max(255),
  applicantEmail: z.string().email().max(255),
  applicantPhone: z.string().max(20).optional(),
  resumeUrl: z.string().url().max(2000).optional(),
  coverLetter: z.string().max(10000).optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const updateJobApplicationStatusSchema = z.object({
  status: z.enum(jobApplicationStatusValues),
  reviewNotes: z.string().max(2000).optional(),
});

export const jobApplicationFiltersSchema = z.object({
  jobId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  status: z.enum(jobApplicationStatusValues).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "updatedAt"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type UpdateJobInput = z.infer<typeof updateJobSchema>;
export type PublishJobInput = z.infer<typeof publishJobSchema>;
export type JobFilters = z.infer<typeof jobFiltersSchema>;
export type CreateJobApplicationInput = z.infer<typeof createJobApplicationSchema>;
export type UpdateJobApplicationStatusInput = z.infer<typeof updateJobApplicationStatusSchema>;
export type JobApplicationFilters = z.infer<typeof jobApplicationFiltersSchema>;
