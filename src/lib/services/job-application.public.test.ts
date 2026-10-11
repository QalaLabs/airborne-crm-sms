import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { JobApplicationService } from "./job.service";
import { AuditService } from "./audit.service";
import { ActivityFeedService } from "./activity.service";
import { publicJobApplicationSchema } from "@/lib/validations/public-job-application.schema";
import { AppError } from "@/lib/utils/errors";
import { withApplicationCount } from "@/lib/repositories/job.repository";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const JOB = "00000000-0000-4000-8000-000000000b01";

type Job = { id: string; title: string; status: string; closesAt: Date | null; orgId: string };
type App = { id: string; orgId: string; jobId: string; applicantEmail: string; status: string };

function harness(jobs: Job[], existing: App[] = []) {
  const apps = [...existing];
  const audits: unknown[] = [];
  const lockCalls: unknown[] = [];
  const orig = {
    jobFind: prisma.job.findFirst,
    tx: prisma.$transaction,
    evt: prisma.internalEvent.create,
    audit: AuditService.write,
    feed: ActivityFeedService.write,
  };
  const tx = {
    $queryRaw: async (...args: unknown[]) => { lockCalls.push(args); return []; },
    jobApplication: {
      findFirst: async (a: any) =>
        apps.find(
          (x) =>
            x.orgId === a.where.orgId &&
            x.jobId === a.where.jobId &&
            x.applicantEmail.toLowerCase() === String(a.where.applicantEmail.equals).toLowerCase() &&
            x.status !== "WITHDRAWN",
        ) ?? null,
      create: async (a: any) => {
        const row = { id: `app-${apps.length + 1}`, status: "SUBMITTED", createdAt: new Date(), ...a.data };
        apps.push(row);
        return { id: row.id, jobId: row.jobId, status: row.status, createdAt: row.createdAt };
      },
    },
  };
  (prisma.job as any).findFirst = async (a: any) =>
    jobs.find((j) => j.id === a.where.id && j.orgId === a.where.orgId) ?? null;
  (prisma as any).$transaction = async (fn: any) => fn(tx);
  (prisma.internalEvent as any).create = async () => { throw new Error("events disabled in unit test"); };
  (AuditService as any).write = async (p: unknown) => { audits.push(p); };
  (ActivityFeedService as any).write = async () => {};
  const origErr = console.error;
  console.error = () => {};
  return {
    apps,
    audits,
    lockCalls,
    restore() {
      (prisma.job as any).findFirst = orig.jobFind;
      (prisma as any).$transaction = orig.tx;
      (prisma.internalEvent as any).create = orig.evt;
      (AuditService as any).write = orig.audit;
      (ActivityFeedService as any).write = orig.feed;
      console.error = origErr;
    },
  };
}

const valid = {
  jobId: JOB,
  applicantName: "Riya Sharma",
  applicantEmail: "Riya@Example.com",
  applicantPhone: "+91 99537 77320",
  consent: true as const,
};

const openJob: Job = { id: JOB, orgId: ORG, title: "First Officer", status: "PUBLISHED", closesAt: null };

async function expectStatus(p: Promise<unknown>, status: number) {
  await assert.rejects(p, (err: unknown) => err instanceof AppError && err.statusCode === status);
}

test("public application succeeds for a published open job and is linked to job + org", async () => {
  const h = harness([openJob]);
  try {
    const input = publicJobApplicationSchema.parse(valid);
    const out = await JobApplicationService.submitPublic(ORG, input, { ipAddress: "1.2.3.4" });
    assert.equal(out.status, "SUBMITTED");
    assert.equal(h.apps.length, 1);
    const row = h.apps[0] as any;
    assert.equal(row.orgId, ORG);
    assert.equal(row.jobId, JOB);
    assert.equal(row.applicantEmail, "riya@example.com");
    assert.equal(row.applicantPhone, "+919953777320");
    assert.equal(row.metadata.source, "public_portal");
    assert.equal(h.lockCalls.length, 1, "job row must be locked before the duplicate check");
    assert.equal((h.audits[0] as any).action, "job_application.submitted");
  } finally {
    h.restore();
  }
});

test("nonexistent job (or job in another org) is 404", async () => {
  const h = harness([{ ...openJob, orgId: "00000000-0000-4000-8000-0000000000bb" }]);
  try {
    await expectStatus(JobApplicationService.submitPublic(ORG, publicJobApplicationSchema.parse(valid)), 404);
    assert.equal(h.apps.length, 0);
  } finally {
    h.restore();
  }
});

test("unpublished / closed / archived job is rejected", async () => {
  for (const status of ["DRAFT", "CLOSED", "ARCHIVED"]) {
    const h = harness([{ ...openJob, status }]);
    try {
      await expectStatus(JobApplicationService.submitPublic(ORG, publicJobApplicationSchema.parse(valid)), 409);
      assert.equal(h.apps.length, 0, status);
    } finally {
      h.restore();
    }
  }
});

test("expired job (closesAt in the past) is rejected", async () => {
  const h = harness([{ ...openJob, closesAt: new Date(Date.now() - 60_000) }]);
  try {
    await expectStatus(JobApplicationService.submitPublic(ORG, publicJobApplicationSchema.parse(valid)), 409);
  } finally {
    h.restore();
  }
});

test("duplicate submission for the same job + email (any case) is 409; withdrawn allows re-apply", async () => {
  const h = harness([openJob], [{ id: "a0", orgId: ORG, jobId: JOB, applicantEmail: "riya@example.com", status: "SUBMITTED" }]);
  try {
    await expectStatus(
      JobApplicationService.submitPublic(ORG, publicJobApplicationSchema.parse({ ...valid, applicantEmail: "RIYA@example.com" })),
      409,
    );
    assert.equal(h.apps.length, 1);
  } finally {
    h.restore();
  }
  const h2 = harness([openJob], [{ id: "a0", orgId: ORG, jobId: JOB, applicantEmail: "riya@example.com", status: "WITHDRAWN" }]);
  try {
    await JobApplicationService.submitPublic(ORG, publicJobApplicationSchema.parse(valid));
    assert.equal(h2.apps.length, 2);
  } finally {
    h2.restore();
  }
});

test("invalid input is rejected by the public schema", () => {
  const bad = [
    { ...valid, jobId: "not-a-uuid" },
    { ...valid, applicantName: "A" },
    { ...valid, applicantName: "<script>x</script>" },
    { ...valid, applicantEmail: "nope" },
    { ...valid, applicantPhone: "12" },
    { ...valid, consent: false },
    { ...valid, resumeUrl: "javascript:alert(1)" },
    { ...valid, coverLetter: "<img src=x onerror=1>" },
  ];
  for (const b of bad) assert.equal(publicJobApplicationSchema.safeParse(b).success, false, JSON.stringify(b));
  const ok = publicJobApplicationSchema.parse({ ...valid, resumeUrl: "", coverLetter: "Keen to fly." });
  assert.equal(ok.resumeUrl, undefined);
});

test("job API rows expose a flat applicationCount (admin list/detail contract)", () => {
  const out = withApplicationCount({ id: "j", title: "t", _count: { applications: 3 } });
  assert.deepEqual(out, { id: "j", title: "t", applicationCount: 3 });
});

test("public schema never accepts status / orgId / studentId from the caller", () => {
  const parsed = publicJobApplicationSchema.parse({ ...valid, status: "SELECTED", orgId: "x", studentId: "y" } as any);
  assert.equal("status" in parsed, false);
  assert.equal("orgId" in parsed, false);
  assert.equal("studentId" in parsed, false);
});
