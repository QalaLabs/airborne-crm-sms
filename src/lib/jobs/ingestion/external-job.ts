import { z } from "zod";
import { createJobSchema, type CreateJobInput } from "@/lib/validations/job.schema";
import { isHttpUrl, jobDedupeKey, parseClosesAt } from "@/lib/jobs/job-import";

/**
 * Provider-agnostic job record accepted by the ingestion pipeline. Any
 * external source (a scraper pushing to /api/webhooks/jobs-ingest, or a pull
 * provider registered in providers.ts) must deliver records in this shape.
 * They are then mapped onto createJobSchema — the single job validation.
 */
export const externalJobSchema = z
  .object({
    externalId: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(255),
    company: z.string().trim().max(255).optional(),
    companyLogoUrl: z.string().trim().max(2000).optional(),
    location: z.string().trim().max(255).optional(),
    remote: z.boolean().optional(),
    employmentType: z.string().trim().max(50).optional(),
    description: z.string().max(20000).optional(),
    requirements: z.string().max(10000).optional(),
    salaryMin: z.number().positive().optional(),
    salaryMax: z.number().positive().optional(),
    currency: z.string().trim().length(3).optional(),
    experienceYears: z.number().int().min(0).max(60).optional(),
    applyUrl: z.string().trim().max(2000).optional(),
    closesAt: z.string().trim().max(40).optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  })
  .strip();

export type ExternalJob = z.infer<typeof externalJobSchema>;

export const MAX_INGEST_ITEMS = 200;

const EMPLOYMENT_TYPES: Record<string, CreateJobInput["jobType"]> = {
  full_time: "full_time",
  fulltime: "full_time",
  permanent: "full_time",
  part_time: "part_time",
  parttime: "part_time",
  contract: "contract",
  contractor: "contract",
  temporary: "contract",
  internship: "internship",
  intern: "internship",
};

export interface IngestIssue {
  index: number;
  externalId?: string;
  message: string;
}

export interface NormalizedExternalJob {
  index: number;
  externalId: string;
  input: CreateJobInput;
  dedupeKey: string;
}

/** Accepts `[...]` or `{ jobs: [...] }`. */
export function extractJobItems(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray((payload as { jobs?: unknown }).jobs)) {
    return (payload as { jobs: unknown[] }).jobs;
  }
  return null;
}

export function normalizeExternalJob(
  raw: unknown,
  index: number,
  sourceId: string,
  now: Date = new Date(),
): { job?: NormalizedExternalJob; issue?: IngestIssue } {
  const parsed = externalJobSchema.safeParse(raw);
  const rawId = raw && typeof raw === "object" ? (raw as { externalId?: unknown }).externalId : undefined;
  const externalId = typeof rawId === "string" ? rawId : undefined;
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { issue: { index, externalId, message: `${first?.path.join(".") || "record"}: ${first?.message ?? "invalid"}` } };
  }
  const ext = parsed.data;
  const fail = (message: string) => ({ issue: { index, externalId: ext.externalId, message } });

  let jobType: CreateJobInput["jobType"] = "full_time";
  if (ext.employmentType) {
    const mapped = EMPLOYMENT_TYPES[ext.employmentType.toLowerCase().replace(/[\s-]+/g, "_")] ??
      EMPLOYMENT_TYPES[ext.employmentType.toLowerCase().replace(/[\s_-]+/g, "")];
    if (!mapped) return fail(`employmentType "${ext.employmentType}" is not supported`);
    jobType = mapped;
  }
  let closesAt: string | undefined;
  if (ext.closesAt) {
    const iso = parseClosesAt(ext.closesAt);
    if (!iso) return fail(`closesAt "${ext.closesAt}" is not a valid date`);
    if (new Date(iso) <= now) return fail(`closesAt ${ext.closesAt} is in the past`);
    closesAt = iso;
  }
  if (ext.salaryMin !== undefined && ext.salaryMax !== undefined && ext.salaryMin > ext.salaryMax) {
    return fail("salaryMax must be greater than or equal to salaryMin");
  }

  const metadata: Record<string, string> = { externalSource: sourceId, externalId: ext.externalId };
  if (ext.company) metadata.airline = ext.company;
  if (ext.applyUrl) {
    if (!isHttpUrl(ext.applyUrl)) return fail(`applyUrl "${ext.applyUrl}" is not a valid http(s) URL`);
    metadata.applyUrl = ext.applyUrl;
  }
  if (ext.companyLogoUrl) {
    if (!isHttpUrl(ext.companyLogoUrl)) return fail(`companyLogoUrl is not a valid http(s) URL`);
    metadata.airlineLogo = ext.companyLogoUrl;
  }

  const canonical = createJobSchema.safeParse({
    title: ext.title,
    description: ext.description,
    requirements: ext.requirements,
    location: ext.location,
    isRemote: ext.remote ?? false,
    jobType,
    salaryMin: ext.salaryMin,
    salaryMax: ext.salaryMax,
    currency: ext.currency?.toUpperCase(),
    experienceYears: ext.experienceYears,
    closesAt,
    tags: ext.tags ? [...new Set(ext.tags)] : [],
    metadata,
  });
  if (!canonical.success) {
    const first = canonical.error.issues[0];
    return fail(`${first?.path.join(".") ?? "job"}: ${first?.message ?? "invalid"}`);
  }
  return {
    job: {
      index,
      externalId: ext.externalId,
      input: canonical.data,
      dedupeKey: jobDedupeKey(ext.title, ext.location, ext.company),
    },
  };
}
