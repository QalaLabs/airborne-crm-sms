import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { generateSlug } from "@/lib/services/job.service";
import { JobRepository } from "@/lib/repositories/job.repository";
import { AppError } from "@/lib/utils/errors";
import {
  jobDedupeKey,
  parseJobCsv,
  type JobImportIssue,
  type NormalizedJobRow,
} from "@/lib/jobs/job-import";
import type { CreateJobInput } from "@/lib/validations/job.schema";
import type { RequestContext } from "@/types";

export interface JobImportPreviewRow {
  rowNumber: number;
  title: string;
  slug: string;
  location: string | null;
  jobType: string;
  company: string | null;
}

export interface JobImportReport {
  dryRun: boolean;
  committed: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  fileErrors: string[];
  errors: JobImportIssue[];
  preview: JobImportPreviewRow[];
  created: { id: string; slug: string; title: string }[];
  batchId: string | null;
}

export interface PreparedJob {
  rowNumber: number;
  input: CreateJobInput;
  slug: string;
}

/** Existing org jobs for duplicate detection (title + location + airline/partner) and slug allocation. */
export async function loadExistingJobKeys(orgId: string) {
  const existing = await prisma.job.findMany({
    where: { orgId },
    select: { slug: true, title: true, location: true, status: true, metadata: true, hiringPartner: { select: { name: true } } },
  });
  const slugs = new Set(existing.map((j) => j.slug));
  const keys = new Map<string, string>();
  for (const j of existing) {
    if (j.status === "ARCHIVED") continue;
    const meta = (j.metadata ?? {}) as Record<string, unknown>;
    const airline = typeof meta.airline === "string" ? meta.airline : null;
    keys.set(jobDedupeKey(j.title, j.location, airline ?? j.hiringPartner?.name ?? null), j.slug);
  }
  return { slugs, keys };
}

export function allocateSlug(title: string, taken: Set<string>): string {
  const base = generateSlug(title).replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 240) || "job";
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

/**
 * All-or-nothing creation of DRAFT jobs in one transaction, with a per-job
 * `job.created` audit row plus one summary audit row.
 */
export async function persistJobs(
  ctx: RequestContext,
  jobs: PreparedJob[],
  summary: { action: string; batchId: string; details: Record<string, unknown> },
) {
  const created = await prisma.$transaction(
    async (tx) => {
      const out: { id: string; slug: string; title: string }[] = [];
      for (const job of jobs) {
        const row = await JobRepository.create(ctx.orgId, ctx.user.id, job.input, job.slug, tx);
        out.push({ id: row.id, slug: row.slug, title: row.title });
        await AuditService.write(
          {
            orgId: ctx.orgId,
            userId: ctx.user.id,
            requestId: ctx.requestId,
            action: "job.created",
            entityType: "job",
            entityId: row.id,
            newValue: { title: row.title, slug: row.slug, via: summary.action, batchId: summary.batchId },
          },
          tx,
        );
      }
      await AuditService.write(
        {
          orgId: ctx.orgId,
          userId: ctx.user.id,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          action: summary.action,
          entityType: "job",
          entityId: summary.batchId,
          newValue: { batchId: summary.batchId, created: out.length, jobIds: out.map((j) => j.id), ...summary.details },
        },
        tx,
      );
      return out;
    },
    { timeout: 60_000 },
  );

  if (created.length > 0) {
    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "imported",
      objectType: "job",
      objectId: summary.batchId,
      objectSnapshot: { count: created.length },
      context: { actorName: ctx.user.name },
    });
  }
  return created;
}

export class JobImportService {
  /**
   * Preview (dryRun) or commit a CSV. Commit re-validates the whole file and
   * refuses to write anything while any row is invalid (no partial import).
   */
  static async run(ctx: RequestContext, csv: string, dryRun: boolean, now: Date = new Date()): Promise<JobImportReport> {
    const parsed = parseJobCsv(csv, now);
    const errors: JobImportIssue[] = [...parsed.issues];
    const report: JobImportReport = {
      dryRun,
      committed: false,
      totalRows: parsed.totalRows,
      validRows: 0,
      invalidRows: 0,
      fileErrors: parsed.fileErrors,
      errors,
      preview: [],
      created: [],
      batchId: null,
    };

    let prepared: PreparedJob[] = [];
    if (parsed.fileErrors.length === 0) {
      const partners = await this.resolveHiringPartners(ctx.orgId, parsed.rows);
      const { slugs, keys } = await loadExistingJobKeys(ctx.orgId);

      const ready: (NormalizedJobRow & { company: string | null })[] = [];
      for (const row of parsed.rows) {
        if (row.hiringPartner) {
          const partner = partners.get(row.hiringPartner.toLowerCase());
          if (!partner) {
            errors.push({ rowNumber: row.rowNumber, column: "hiring_partner", message: `Unknown hiring partner "${row.hiringPartner}" in this organization` });
            continue;
          }
          row.input.hiringPartnerId = partner.id;
        }
        const existingSlug = keys.get(row.dedupeKey);
        if (existingSlug) {
          errors.push({ rowNumber: row.rowNumber, message: `A job with the same title, location and airline/partner already exists (/${existingSlug})` });
          continue;
        }
        if (row.input.slug && slugs.has(row.input.slug)) {
          errors.push({ rowNumber: row.rowNumber, column: "slug", message: `slug "${row.input.slug}" is already used by another job` });
          continue;
        }
        const company = ((row.input.metadata as Record<string, unknown>).airline as string | undefined) ?? row.hiringPartner ?? null;
        ready.push({ ...row, company });
      }

      for (const row of ready) {
        if (row.input.slug) slugs.add(row.input.slug);
      }
      prepared = ready.map((row) => ({
        rowNumber: row.rowNumber,
        input: row.input,
        slug: row.input.slug ?? allocateSlug(row.input.title, slugs),
      }));
      report.preview = ready.map((row, i) => ({
        rowNumber: row.rowNumber,
        title: row.input.title,
        slug: prepared[i]!.slug,
        location: row.input.location ?? null,
        jobType: row.input.jobType,
        company: row.company,
      }));
    }

    errors.sort((a, b) => a.rowNumber - b.rowNumber);
    report.invalidRows = new Set(errors.map((e) => e.rowNumber)).size;
    report.validRows = prepared.length;

    if (dryRun) return report;

    if (report.fileErrors.length > 0 || errors.length > 0) {
      throw new AppError(
        "IMPORT_HAS_ERRORS",
        `Nothing was imported: fix ${report.fileErrors.length > 0 ? "the file" : `${report.invalidRows} invalid row(s)`} and upload again`,
        422,
        [...report.fileErrors.map((message) => ({ message })), ...errors.slice(0, 50).map((e) => ({ path: [`row ${e.rowNumber}`], message: e.message }))],
      );
    }
    if (prepared.length === 0) {
      throw new AppError("IMPORT_EMPTY", "The file has no rows to import", 422);
    }

    const batchId = randomUUID();
    report.created = await persistJobs(ctx, prepared, {
      action: "job.bulk_imported",
      batchId,
      details: { source: "csv", totalRows: report.totalRows },
    });
    report.batchId = batchId;
    report.committed = true;
    return report;
  }

  private static async resolveHiringPartners(orgId: string, rows: NormalizedJobRow[]) {
    const refs = [...new Set(rows.map((r) => r.hiringPartner).filter((x): x is string => Boolean(x)))];
    const map = new Map<string, { id: string }>();
    if (refs.length === 0) return map;
    const partners = await prisma.hiringPartner.findMany({
      where: {
        orgId,
        OR: [{ slug: { in: refs.map((r) => r.toLowerCase()) } }, { name: { in: refs, mode: "insensitive" } }],
      },
      select: { id: true, name: true, slug: true },
    });
    for (const p of partners) {
      map.set(p.slug.toLowerCase(), { id: p.id });
      map.set(p.name.toLowerCase(), { id: p.id });
    }
    return map;
  }
}
