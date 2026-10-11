/**
 * Pull-based job sources. No live external provider is configured for this
 * project yet: adding one means implementing JobSourceProvider (with its own
 * allowlisted https host, credentials from env, timeout and size limits) and
 * registering it below. Admins can only trigger providers by id — the API never
 * accepts a URL, so there is no SSRF surface.
 *
 * The fixture provider returns deterministic sample data and is only enabled
 * when JOB_SOURCE_FIXTURE=1 (local / E2E environments).
 */
export interface JobSourceProvider {
  id: string;
  name: string;
  description: string;
  fetchJobs(opts: { signal: AbortSignal }): Promise<unknown>;
}

export const PROVIDER_CONFIG_REQUIRED = "Provider configuration required for live external scraping.";

export const FIXTURE_JOBS = [
  {
    externalId: "fixture-001",
    title: "First Officer — A320 (Fixture)",
    company: "Fixture Airways",
    location: "Mumbai",
    employmentType: "full-time",
    description: "Deterministic fixture record for ingestion tests.",
    salaryMin: 150000,
    salaryMax: 250000,
    experienceYears: 2,
    applyUrl: "https://careers.fixture.example/apply/001",
    tags: ["pilot", "a320"],
  },
  {
    externalId: "fixture-002",
    title: "Cabin Crew Trainee (Fixture)",
    company: "Fixture Airways",
    location: "Delhi",
    employmentType: "internship",
    tags: ["cabin crew"],
  },
  {
    externalId: "fixture-003",
    title: "Ground Operations Executive (Fixture)",
    company: "Fixture Ground Services",
    location: "Bengaluru",
    employmentType: "contract",
  },
  { externalId: "fixture-bad", company: "Fixture Airways" },
];

export const fixtureJobProvider: JobSourceProvider = {
  id: "fixture",
  name: "Fixture feed (test data)",
  description: "Deterministic sample jobs for local and E2E testing. Not a live source.",
  async fetchJobs({ signal }) {
    if (signal.aborted) throw new Error("aborted");
    return { jobs: FIXTURE_JOBS };
  },
};

export function getJobSourceProviders(env: Record<string, string | undefined> = process.env): JobSourceProvider[] {
  const providers: JobSourceProvider[] = [];
  if (env.JOB_SOURCE_FIXTURE === "1") providers.push(fixtureJobProvider);
  return providers;
}
