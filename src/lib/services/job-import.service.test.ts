import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { AuditService } from "./audit.service";
import { ActivityFeedService } from "./activity.service";
import { JobRepository } from "@/lib/repositories/job.repository";
import { JobImportService } from "./job-import.service";
import { ingestJobs, runProviderSync, listJobSources } from "./job-ingestion.service";
import { fixtureJobProvider, getJobSourceProviders, PROVIDER_CONFIG_REQUIRED, type JobSourceProvider } from "@/lib/jobs/ingestion/providers";
import { AppError } from "@/lib/utils/errors";
import type { RequestContext } from "@/types";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000bb";
const PARTNER = "00000000-0000-4000-8000-0000000000c1";
const NOW = new Date("2026-10-02T06:30:00.000Z");

const ctx = (orgId = ORG) =>
  ({ orgId, user: { id: "u1", orgId, role: "ADMIN", name: "Tester" }, requestId: "req-1", ipAddress: "127.0.0.1" }) as unknown as RequestContext;

type Job = { id: string; orgId: string; slug: string; title: string; location: string | null; status: string; metadata: Record<string, unknown>; hiringPartner: { name: string } | null; createdBy: string | null; hiringPartnerId?: string };

function harness(seed: { jobs?: Job[]; partners?: { id: string; orgId: string; name: string; slug: string }[]; failOnCreate?: number } = {}) {
  const state = {
    jobs: [...(seed.jobs ?? [])],
    partners: seed.partners ?? [],
    audits: [] as any[],
    feed: [] as any[],
    advisoryLocks: 0,
    findManyWheres: [] as any[],
  };
  const orig = {
    jobFindMany: prisma.job.findMany,
    partnerFindMany: prisma.hiringPartner.findMany,
    tx: prisma.$transaction,
    create: JobRepository.create,
    audit: AuditService.write,
    feed: ActivityFeedService.write,
  };
  const filterJobs = (where: any) =>
    state.jobs.filter((j) => {
      if (j.orgId !== where.orgId) return false;
      if (where.metadata?.path) return j.metadata[where.metadata.path[0]] === where.metadata.equals;
      return true;
    });
  (prisma.job as any).findMany = async (args: any) => {
    state.findManyWheres.push(args.where);
    return filterJobs(args.where);
  };
  (prisma.hiringPartner as any).findMany = async (args: any) => {
    const slugs: string[] = args.where.OR[0].slug.in;
    const names: string[] = args.where.OR[1].name.in.map((n: string) => n.toLowerCase());
    return state.partners.filter((p) => p.orgId === args.where.orgId && (slugs.includes(p.slug) || names.includes(p.name.toLowerCase())));
  };
  (prisma as any).$transaction = async (fn: any) => {
    const snapshot = { jobs: [...state.jobs], audits: [...state.audits] };
    const tx = {
      $executeRaw: async () => {
        state.advisoryLocks += 1;
        return 1;
      },
      job: { findMany: async (args: any) => filterJobs(args.where) },
    };
    try {
      return await fn(tx);
    } catch (e) {
      state.jobs = snapshot.jobs;
      state.audits = snapshot.audits;
      throw e;
    }
  };
  let creates = 0;
  (JobRepository as any).create = async (orgId: string, createdBy: string | null, input: any, slug: string) => {
    creates += 1;
    if (seed.failOnCreate && creates === seed.failOnCreate) throw new Error("db write failed");
    const job: Job = { id: `job-${state.jobs.length + 1}`, orgId, slug, title: input.title, location: input.location ?? null, status: "DRAFT", metadata: input.metadata ?? {}, hiringPartner: null, createdBy, hiringPartnerId: input.hiringPartnerId };
    state.jobs.push(job);
    return job;
  };
  (AuditService as any).write = async (p: any) => {
    state.audits.push(p);
  };
  (ActivityFeedService as any).write = async (p: any) => {
    state.feed.push(p);
  };
  return {
    state,
    restore() {
      (prisma.job as any).findMany = orig.jobFindMany;
      (prisma.hiringPartner as any).findMany = orig.partnerFindMany;
      (prisma as any).$transaction = orig.tx;
      (JobRepository as any).create = orig.create;
      (AuditService as any).write = orig.audit;
      (ActivityFeedService as any).write = orig.feed;
    },
  };
}

let h: ReturnType<typeof harness> | null = null;
afterEach(() => {
  h?.restore();
  h = null;
});

const existingJob = (over: Partial<Job> = {}): Job => ({
  id: "existing-1", orgId: ORG, slug: "cabin-crew", title: "Cabin Crew", location: "Delhi", status: "PUBLISHED",
  metadata: { airline: "IndiGo" }, hiringPartner: null, createdBy: null, ...over,
});

const isStatus = (code: number) => (e: unknown) => e instanceof AppError && e.statusCode === code;

describe("JobImportService (bulk CSV)", () => {
  it("preview validates without writing; commit creates DRAFT jobs + audits", async () => {
    h = harness({ jobs: [existingJob({ slug: "pilot" })] });
    const csv = "title,location,airline\nPilot,Mumbai,Air India\nCabin Crew,Delhi,Akasa\n";
    const preview = await JobImportService.run(ctx(), csv, true, NOW);
    assert.equal(preview.committed, false);
    assert.equal(preview.totalRows, 2);
    assert.equal(preview.validRows, 2);
    assert.equal(preview.invalidRows, 0);
    assert.deepEqual(preview.preview.map((p) => p.slug), ["pilot-2", "cabin-crew"]);
    assert.equal(h.state.jobs.length, 1, "dry run writes nothing");
    assert.equal(h.state.audits.length, 0);

    const done = await JobImportService.run(ctx(), csv, false, NOW);
    assert.equal(done.committed, true);
    assert.equal(done.created.length, 2);
    assert.equal(h.state.jobs.length, 3);
    assert.ok(h.state.jobs.slice(1).every((j) => j.status === "DRAFT" && j.orgId === ORG && j.createdBy === "u1"));
    assert.equal(h.state.audits.filter((a) => a.action === "job.created").length, 2);
    const summary = h.state.audits.find((a) => a.action === "job.bulk_imported");
    assert.equal(summary.newValue.created, 2);
    assert.equal(summary.newValue.batchId, done.batchId);
    assert.equal(h.state.feed.length, 1);
  });

  it("mixed valid/invalid file: preview reports both, commit imports nothing (all-or-nothing)", async () => {
    h = harness();
    const csv = "title,job_type\nGood Job,full_time\nBad Job,freelance\n";
    const preview = await JobImportService.run(ctx(), csv, true, NOW);
    assert.equal(preview.validRows, 1);
    assert.equal(preview.invalidRows, 1);
    assert.equal(preview.errors[0]!.rowNumber, 3);
    await assert.rejects(JobImportService.run(ctx(), csv, false, NOW), isStatus(422));
    assert.equal(h.state.jobs.length, 0);
    assert.equal(h.state.audits.length, 0);
  });

  it("missing columns / malformed file cannot be committed", async () => {
    h = harness();
    const r = await JobImportService.run(ctx(), "location\nDelhi\n", true, NOW);
    assert.match(r.fileErrors.join(), /Missing required column "title"/);
    await assert.rejects(JobImportService.run(ctx(), "location\nDelhi\n", false, NOW), isStatus(422));
    await assert.rejects(JobImportService.run(ctx(), 'title\n"open\n', false, NOW), isStatus(422));
  });

  it("rejects rows duplicating existing jobs (title+location+airline) or existing slugs", async () => {
    h = harness({ jobs: [existingJob()] });
    const r = await JobImportService.run(ctx(), "title,location,airline,slug\ncabin crew,DELHI,indigo,\nNew,Pune,,cabin-crew\n", true, NOW);
    assert.equal(r.validRows, 0);
    assert.match(r.errors[0]!.message, /already exists \(\/cabin-crew\)/);
    assert.match(r.errors[1]!.message, /slug "cabin-crew" is already used/);
  });

  it("archived jobs do not block re-import but their slug stays reserved", async () => {
    h = harness({ jobs: [existingJob({ status: "ARCHIVED" })] });
    const r = await JobImportService.run(ctx(), "title,location,airline\nCabin Crew,Delhi,IndiGo\n", true, NOW);
    assert.equal(r.validRows, 1);
    assert.equal(r.preview[0]!.slug, "cabin-crew-2");
  });

  it("org isolation: hiring partners and duplicates resolve only inside the caller's org", async () => {
    h = harness({
      jobs: [existingJob({ orgId: OTHER_ORG })],
      partners: [{ id: PARTNER, orgId: OTHER_ORG, name: "Fixture Air", slug: "fixture-air" }],
    });
    const r = await JobImportService.run(ctx(), "title,location,airline,hiring_partner\nCabin Crew,Delhi,IndiGo,\nPilot,Delhi,,fixture-air\n", true, NOW);
    assert.equal(r.validRows, 1, "other org's identical job is not a duplicate");
    assert.match(r.errors[0]!.message, /Unknown hiring partner "fixture-air"/);
    assert.ok(h.state.findManyWheres.every((w) => w.orgId === ORG));
  });

  it("resolves an in-org hiring partner by name or slug", async () => {
    h = harness({ partners: [{ id: PARTNER, orgId: ORG, name: "Fixture Air", slug: "fixture-air" }] });
    const done = await JobImportService.run(ctx(), "title,hiring_partner\nPilot,FIXTURE AIR\nEngineer,fixture-air\n", false, NOW);
    assert.equal(done.created.length, 2);
    assert.ok(h.state.jobs.every((j) => j.hiringPartnerId === PARTNER));
  });

  it("a DB failure mid-commit rolls back every row and writes no audit", async () => {
    h = harness({ failOnCreate: 2 });
    await assert.rejects(JobImportService.run(ctx(), "title\nA\nB\nC\n", false, NOW), /db write failed/);
    assert.equal(h.state.jobs.length, 0);
    assert.equal(h.state.audits.length, 0);
  });
});

const actor = (orgId = ORG) => ({ orgId, userId: "u1", userName: "Tester", via: "pull" as const });

describe("job ingestion (provider-agnostic)", () => {
  it("valid + malformed records: creates valid DRAFTs, reports invalid, audits the run", async () => {
    h = harness();
    const r = await ingestJobs(actor(), "fixture", { jobs: [
      { externalId: "a1", title: "Pilot", company: "Air X", location: "Delhi", employmentType: "Full-Time", applyUrl: "https://x.example/a1" },
      { externalId: "a2", title: "" },
      { externalId: "a3", title: "Engineer", applyUrl: "ftp://x.example" },
      { title: "No id" },
      { externalId: "a4", title: "Crew", employmentType: "gig" },
    ] }, NOW);
    assert.equal(r.received, 5);
    assert.equal(r.created.length, 1);
    assert.equal(r.invalid.length, 4);
    assert.equal(h.state.jobs[0]!.status, "DRAFT");
    assert.deepEqual(h.state.jobs[0]!.metadata, { externalSource: "fixture", externalId: "a1", airline: "Air X", applyUrl: "https://x.example/a1" });
    assert.equal(h.state.advisoryLocks, 1);
    const run = h.state.audits.find((a) => a.action === "job.ingested");
    assert.equal(run.newValue.created, 1);
    assert.equal(run.newValue.invalid, 4);
  });

  it("is idempotent: re-sending the same feed creates nothing new", async () => {
    h = harness();
    const payload = { jobs: [{ externalId: "x1", title: "Pilot" }, { externalId: "x2", title: "Crew" }] };
    const first = await ingestJobs(actor(), "feed-a", payload, NOW);
    const second = await ingestJobs(actor(), "feed-a", payload, NOW);
    assert.equal(first.created.length, 2);
    assert.equal(second.created.length, 0);
    assert.equal(second.duplicates.length, 2);
    assert.match(second.duplicates[0]!.reason, /already imported/);
    assert.equal(h.state.jobs.length, 2);
  });

  it("dedupes repeats inside one payload and against existing manual jobs", async () => {
    h = harness({ jobs: [existingJob()] });
    const r = await ingestJobs(actor(), "feed-a", [
      { externalId: "d1", title: "Pilot" },
      { externalId: "d1", title: "Pilot again" },
      { externalId: "d2", title: "Cabin Crew", location: "Delhi", company: "IndiGo" },
    ], NOW);
    assert.equal(r.created.length, 1);
    assert.deepEqual(r.duplicates.map((d) => d.reason), ["repeated in this payload", "matches existing job /cabin-crew"]);
  });

  it("same externalId from a different source or org is a different job (org/source isolation)", async () => {
    h = harness();
    await ingestJobs(actor(), "feed-a", [{ externalId: "s1", title: "Pilot" }], NOW);
    const otherSource = await ingestJobs(actor(), "feed-b", [{ externalId: "s1", title: "Pilot B" }], NOW);
    const otherOrg = await ingestJobs(actor(OTHER_ORG), "feed-a", [{ externalId: "s1", title: "Pilot" }], NOW);
    assert.equal(otherSource.created.length, 1);
    assert.equal(otherOrg.created.length, 1);
    assert.equal(h.state.jobs.filter((j) => j.orgId === OTHER_ORG).length, 1);
  });

  it("rejects malformed payloads, oversize batches and bad source ids", async () => {
    h = harness();
    await assert.rejects(ingestJobs(actor(), "feed", { items: [] }, NOW), isStatus(400));
    await assert.rejects(ingestJobs(actor(), "feed", "nope", NOW), isStatus(400));
    await assert.rejects(ingestJobs(actor(), "Bad Source!", [], NOW), isStatus(400));
    await assert.rejects(ingestJobs(actor(), "feed", Array.from({ length: 201 }, (_, i) => ({ externalId: `${i}`, title: "x" })), NOW), isStatus(413));
    assert.equal(h.state.jobs.length, 0);
  });

  it("fixture provider sync is deterministic and re-runnable", async () => {
    h = harness();
    const first = await runProviderSync(actor(), "fixture", { providers: [fixtureJobProvider], now: NOW });
    assert.equal(first.created.length, 3);
    assert.equal(first.invalid.length, 1);
    const again = await runProviderSync(actor(), "fixture", { providers: [fixtureJobProvider], now: NOW });
    assert.equal(again.created.length, 0);
    assert.equal(again.duplicates.length, 3);
  });

  it("times out a hanging provider (504) and audits the failure", async () => {
    h = harness();
    const hanging: JobSourceProvider = { id: "slow", name: "Slow", description: "", fetchJobs: () => new Promise(() => undefined) };
    await assert.rejects(runProviderSync(actor(), "slow", { providers: [hanging], timeoutMs: 20 }), isStatus(504));
    assert.equal(h.state.audits.at(-1).action, "job.ingest_failed");
    assert.equal(h.state.jobs.length, 0);
  });

  it("maps provider errors to 502 without creating jobs", async () => {
    h = harness();
    const broken: JobSourceProvider = { id: "broken", name: "Broken", description: "", fetchJobs: async () => { throw new Error("HTTP 500"); } };
    await assert.rejects(runProviderSync(actor(), "broken", { providers: [broken] }), (e: unknown) => isStatus(502)(e) && /HTTP 500/.test((e as Error).message));
    assert.equal(h.state.jobs.length, 0);
  });

  it("no provider configured -> explicit 'Provider configuration required' (no live scraping invented)", async () => {
    h = harness();
    await assert.rejects(runProviderSync(actor(), "fixture", { providers: [] }), (e: unknown) => isStatus(404)(e) && (e as Error).message === PROVIDER_CONFIG_REQUIRED);
    assert.deepEqual(getJobSourceProviders({}), []);
    assert.deepEqual(getJobSourceProviders({ JOB_SOURCE_FIXTURE: "1" }).map((p) => p.id), ["fixture"]);
    const listing = listJobSources([]);
    assert.equal(listing.liveProviderConfigured, false);
    assert.equal(listing.message, PROVIDER_CONFIG_REQUIRED);
  });
});
