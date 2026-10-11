import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { JobRepository } from "@/lib/repositories/job.repository";
import { allocateSlug, loadExistingJobKeys } from "@/lib/services/job-import.service";
import { AppError } from "@/lib/utils/errors";
import {
  MAX_INGEST_ITEMS,
  extractJobItems,
  normalizeExternalJob,
  type IngestIssue,
  type NormalizedExternalJob,
} from "@/lib/jobs/ingestion/external-job";
import {
  PROVIDER_CONFIG_REQUIRED,
  getJobSourceProviders,
  type JobSourceProvider,
} from "@/lib/jobs/ingestion/providers";

export interface IngestActor {
  orgId: string;
  userId: string | null;
  userName?: string;
  requestId?: string;
  ipAddress?: string;
  via: "push" | "pull";
  keyId?: string;
}

export interface IngestReport {
  source: string;
  received: number;
  created: { id: string; slug: string; title: string; externalId: string }[];
  duplicates: { index: number; externalId: string; reason: string }[];
  invalid: IngestIssue[];
}

export const SOURCE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,49}$/;
export const MAX_PULL_PAYLOAD_BYTES = 2_000_000;
export const DEFAULT_SOURCE_TIMEOUT_MS = 15_000;

/**
 * fetch -> normalize -> validate (createJobSchema) -> dedupe -> persist -> audit.
 *
 * Idempotent per (org, source, externalId): re-sending the same records creates
 * nothing new. Invalid records are skipped and reported individually (a feed
 * cannot be "fixed and re-uploaded" by a person); valid ones are created as
 * DRAFT jobs in one transaction. Nothing is ever auto-published.
 */
export async function ingestJobs(
  actor: IngestActor,
  sourceId: string,
  payload: unknown,
  now: Date = new Date(),
): Promise<IngestReport> {
  if (!SOURCE_ID_RE.test(sourceId)) {
    throw new AppError("INVALID_SOURCE", "source must be lowercase letters, digits, - or _ (max 50)", 400);
  }
  const items = extractJobItems(payload);
  if (!items) throw new AppError("INVALID_PAYLOAD", 'Expected a JSON array of jobs or { "jobs": [...] }', 400);
  if (items.length > MAX_INGEST_ITEMS) {
    throw new AppError("PAYLOAD_TOO_LARGE", `At most ${MAX_INGEST_ITEMS} jobs per request`, 413);
  }

  const report: IngestReport = { source: sourceId, received: items.length, created: [], duplicates: [], invalid: [] };
  const seen = new Set<string>();
  const candidates: NormalizedExternalJob[] = [];
  items.forEach((raw, index) => {
    const { job, issue } = normalizeExternalJob(raw, index, sourceId, now);
    if (issue) return void report.invalid.push(issue);
    if (!job) return;
    if (seen.has(job.externalId)) {
      report.duplicates.push({ index, externalId: job.externalId, reason: "repeated in this payload" });
      return;
    }
    seen.add(job.externalId);
    candidates.push(job);
  });

  const { slugs, keys } = await loadExistingJobKeys(actor.orgId);
  const batchId = randomUUID();

  const created = await prisma.$transaction(
    async (tx) => {
      // Serialize runs of the same org+source so concurrent pushes cannot both
      // insert the same externalId.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${actor.orgId}:jobs:${sourceId}`}))`;
      const existing = await tx.job.findMany({
        where: { orgId: actor.orgId, metadata: { path: ["externalSource"], equals: sourceId } },
        select: { slug: true, metadata: true },
      });
      const existingIds = new Map<string, string>();
      for (const j of existing) {
        const id = (j.metadata as Record<string, unknown> | null)?.externalId;
        if (typeof id === "string") existingIds.set(id, j.slug);
      }

      const out: IngestReport["created"] = [];
      for (const job of candidates) {
        const prior = existingIds.get(job.externalId);
        if (prior) {
          report.duplicates.push({ index: job.index, externalId: job.externalId, reason: `already imported (/${prior})` });
          continue;
        }
        const manual = keys.get(job.dedupeKey);
        if (manual) {
          report.duplicates.push({ index: job.index, externalId: job.externalId, reason: `matches existing job /${manual}` });
          continue;
        }
        const slug = allocateSlug(job.input.title, slugs);
        const row = await JobRepository.create(actor.orgId, actor.userId, job.input, slug, tx);
        out.push({ id: row.id, slug: row.slug, title: row.title, externalId: job.externalId });
        await AuditService.write(
          {
            orgId: actor.orgId,
            userId: actor.userId ?? undefined,
            requestId: actor.requestId,
            action: "job.created",
            entityType: "job",
            entityId: row.id,
            newValue: { title: row.title, slug: row.slug, via: "job.ingested", source: sourceId, externalId: job.externalId, batchId },
          },
          tx,
        );
      }
      await AuditService.write(
        {
          orgId: actor.orgId,
          userId: actor.userId ?? undefined,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          action: "job.ingested",
          entityType: "job",
          entityId: batchId,
          newValue: {
            batchId,
            source: sourceId,
            via: actor.via,
            keyId: actor.keyId ?? null,
            received: report.received,
            created: out.length,
            duplicates: report.duplicates.length,
            invalid: report.invalid.length,
            jobIds: out.map((j) => j.id),
          },
        },
        tx,
      );
      return out;
    },
    { timeout: 60_000 },
  );
  report.created = created;
  report.duplicates.sort((a, b) => a.index - b.index);

  if (created.length > 0 && actor.userId) {
    await ActivityFeedService.write({
      orgId: actor.orgId,
      actorId: actor.userId,
      verb: "imported",
      objectType: "job",
      objectId: batchId,
      objectSnapshot: { count: created.length, source: sourceId },
      context: { actorName: actor.userName ?? "Job feed" },
    });
  }
  return report;
}

export function listJobSources(providers: JobSourceProvider[] = getJobSourceProviders()) {
  return {
    providers: providers.map((p) => ({ id: p.id, name: p.name, description: p.description })),
    liveProviderConfigured: providers.some((p) => p.id !== "fixture"),
    message: PROVIDER_CONFIG_REQUIRED,
  };
}

/** Run one registered pull provider with a hard timeout and payload size cap. */
export async function runProviderSync(
  actor: IngestActor,
  providerId: string,
  opts: { providers?: JobSourceProvider[]; timeoutMs?: number; now?: Date } = {},
): Promise<IngestReport> {
  const providers = opts.providers ?? getJobSourceProviders();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) {
    throw new AppError(
      "PROVIDER_NOT_CONFIGURED",
      providers.length === 0 ? PROVIDER_CONFIG_REQUIRED : `Unknown job source "${providerId}"`,
      404,
    );
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let payload: unknown;
  try {
    payload = await Promise.race([
      provider.fetchJobs({ signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new AppError("SOURCE_TIMEOUT", `Job source "${provider.id}" did not respond within ${timeoutMs} ms`, 504));
        }, timeoutMs);
      }),
    ]);
  } catch (err) {
    const failure =
      err instanceof AppError
        ? err
        : new AppError("SOURCE_FAILED", `Job source "${provider.id}" failed: ${err instanceof Error ? err.message : "unknown error"}`, 502);
    await AuditService.write({
      orgId: actor.orgId,
      userId: actor.userId ?? undefined,
      requestId: actor.requestId,
      action: "job.ingest_failed",
      entityType: "job",
      newValue: { source: provider.id, code: failure.code, message: failure.message },
    });
    throw failure;
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (JSON.stringify(payload ?? null).length > MAX_PULL_PAYLOAD_BYTES) {
    throw new AppError("PAYLOAD_TOO_LARGE", `Job source "${provider.id}" returned more than 2 MB`, 413);
  }
  return ingestJobs(actor, provider.id, payload, opts.now);
}
