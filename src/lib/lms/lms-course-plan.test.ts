import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  buildSyncPlan,
  buildTargets,
  diffAgainstTarget,
  humanDuration,
  modeLabel,
  type MarketingCourse,
  type WebsiteCourse,
} from "./lms-course-plan";
import { courseOverview, isOverviewOnly, PUBLIC_SITE_URL } from "./course-overview";

const REGISTRY = pathToFileURL(resolve(process.cwd(), "..", "src", "lib", "schema", "courseRegistry.js")).href;

async function websiteCourses(): Promise<WebsiteCourse[]> {
  const mod = (await import(REGISTRY)) as { COURSE_SCHEMA: Record<string, WebsiteCourse> };
  return Object.values(mod.COURSE_SCHEMA);
}

const EXPECTED_SLUGS = [
  "ground-school",
  "commercial-pilot-license-cpl",
  "atpl",
  "cabin-crew-training",
  "cadet-preparation",
  "a320-simulator",
  "cas-compass-adapt",
  "airline-preparation",
  "gd-pi",
  "private-pilot-license",
  "securing-your-childs-future-in-aviation",
];

const marketing: MarketingCourse[] = [
  { id: "m-cpl", slug: "cpl-ground-classes", status: "PUBLISHED", fee: "270000", duration: "3–4 Months" },
  { id: "m-cabin", slug: "cabin-crew", status: "PUBLISHED", fee: "54000", duration: "3–6 Months" },
  { id: "m-atpl", slug: "atpl", status: "PUBLISHED", fee: "150000", duration: "4–6 Months" },
  { id: "m-sim", slug: "a320-simulator", status: "PUBLISHED", fee: "10000", duration: "Flexible (10-Hour Package)" },
  { id: "m-old", slug: "cadet-preparation", status: "ARCHIVED", fee: "1", duration: "x" },
];

const toMarketingSlug = (s: string) =>
  ({ "commercial-pilot-license-cpl": "cpl-ground-classes", "cabin-crew-training": "cabin-crew" } as Record<string, string>)[s] ?? s;
const feeLabel = (_slug: string, fee: string | number | null | undefined) =>
  fee ? `₹${Number(fee).toLocaleString("en-IN")}` : null;

async function targets() {
  return buildTargets({
    websiteCourses: await websiteCourses(),
    catalogItems: [{ marketingSlug: "gd-pi", duration: "3 Months", price: "₹30,000" }],
    marketingCourses: marketing,
    toMarketingSlug,
    feeLabel,
  });
}

test("the website registry yields exactly the 11 canonical course targets", async () => {
  const t = await targets();
  assert.deepEqual(t.map((c) => c.slug), EXPECTED_SLUGS);
  assert.ok(t.every((c) => c.metadata.overviewOnly === true && c.metadata.source === "website-course-registry"));
  assert.ok(t.every((c) => c.title && c.description && c.metadata.websitePath === `/courses/${c.slug}`));
  const plan = buildSyncPlan(t, []);
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.entries.filter((e) => e.action === "create").length, 11);
});

test("marketing mapping: website slug → published Admin course; archived records are ignored", async () => {
  const bySlug = new Map((await targets()).map((c) => [c.slug, c]));
  assert.equal(bySlug.get("commercial-pilot-license-cpl")!.marketingCourseId, "m-cpl");
  assert.equal(bySlug.get("cabin-crew-training")!.marketingCourseId, "m-cabin");
  assert.equal(bySlug.get("atpl")!.marketingCourseId, "m-atpl");
  assert.equal(bySlug.get("cadet-preparation")!.marketingCourseId, null, "ARCHIVED marketing course is not linked");
  assert.equal(bySlug.get("ground-school")!.marketingCourseId, null);
});

test("fee/duration prefer the Admin marketing course, then the website catalog, then the registry", async () => {
  const bySlug = new Map((await targets()).map((c) => [c.slug, c]));
  const sim = bySlug.get("a320-simulator")!.metadata;
  assert.equal(sim.fee, "₹10,000");
  assert.equal(sim.duration, "Flexible (10-Hour Package)");
  const gdpi = bySlug.get("gd-pi")!.metadata;
  assert.equal(gdpi.fee, "₹30,000");
  assert.equal(gdpi.duration, "3 Months");
  const ground = bySlug.get("ground-school")!.metadata;
  assert.equal(ground.duration, "3 months");
  assert.equal(ground.fee, "₹2,70,000");
  assert.equal(bySlug.get("atpl")!.metadata.mode, "Blended (on-site + online)");
  assert.equal(humanDuration("P4W"), "4 weeks");
  assert.equal(humanDuration("P1M"), "1 month");
  assert.equal(humanDuration(undefined), null);
  assert.equal(modeLabel("onsite"), "On-site");
  assert.equal(modeLabel("teleport"), null);
});

test("duplicate prevention: re-running after apply creates nothing", async () => {
  const t = await targets();
  const stored = t.map((c, i) => ({ id: `l${i}`, slug: c.slug, title: c.title, marketingCourseId: c.marketingCourseId, metadata: c.metadata }));
  const plan = buildSyncPlan(t, stored);
  assert.equal(plan.entries.filter((e) => e.action === "create").length, 0);
  assert.equal(plan.entries.filter((e) => e.action === "exists").length, 11);
  assert.deepEqual(diffAgainstTarget(stored[0]!, t[0]!), []);
});

test("slug collision: an existing LMS course with the same slug is kept, never recreated or overwritten", async () => {
  const t = await targets();
  const plan = buildSyncPlan(t, [{ id: "legacy", slug: "atpl", title: "Old ATPL", marketingCourseId: null, metadata: {} }]);
  const atpl = plan.entries.find((e) => e.target.slug === "atpl")!;
  assert.equal(atpl.action, "exists");
  assert.equal(atpl.existingId, "legacy");
  assert.ok(diffAgainstTarget({ slug: "atpl", title: "Old ATPL", marketingCourseId: null, metadata: {} }, atpl.target).length > 0);
  assert.equal(plan.entries.filter((e) => e.action === "create").length, 10);
});

test("a marketing course already linked to another LMS course blocks the create", async () => {
  const t = await targets();
  const plan = buildSyncPlan(t, [{ id: "x", slug: "cpl-legacy", title: "CPL", marketingCourseId: "m-cpl", metadata: {} }]);
  const cpl = plan.entries.find((e) => e.target.slug === "commercial-pilot-license-cpl")!;
  assert.equal(cpl.action, "blocked");
  assert.match(cpl.reason ?? "", /cpl-legacy/);
});

test("plan problems: wrong course count, duplicate and invalid slugs are reported", async () => {
  const t = await targets();
  assert.match(buildSyncPlan(t.slice(0, 10), []).problems.join(), /expected 11/);
  assert.match(buildSyncPlan([...t.slice(0, 10), { ...t[0]! }], []).problems.join(), /duplicate target slug/);
  assert.match(buildSyncPlan([...t.slice(0, 10), { ...t[10]!, slug: "Bad Slug" }], []).problems.join(), /invalid slug/);
});

test("semantic title matches against existing LMS courses are reported, not merged", async () => {
  const t = await targets();
  const plan = buildSyncPlan(t, [
    { id: "d", slug: "dgca-cpl-ground-school", title: "DGCA CPL Ground School", marketingCourseId: null, metadata: {} },
    { id: "s", slug: "a320-simulator-1-hour", title: "A320 Simulator 1 Hour", marketingCourseId: null, metadata: {} },
  ]);
  const match = plan.semanticMatches.find((m) => m.lmsSlug === "dgca-cpl-ground-school" && m.websiteSlug === "commercial-pilot-license-cpl");
  assert.ok(match && match.score === 1);
  assert.equal(plan.entries.filter((e) => e.action === "create").length, 11, "matches never suppress or merge creates");
});

test("overview-only helpers: flag, labelled facts, safe website link, malformed metadata", () => {
  assert.equal(isOverviewOnly({ metadata: { overviewOnly: true } }), true);
  assert.equal(isOverviewOnly({ metadata: { overviewOnly: "true" } }), false);
  assert.equal(isOverviewOnly({ metadata: null }), false);
  assert.equal(isOverviewOnly({ metadata: [] }), false);
  assert.deepEqual(courseOverview({ duration: "3 Months", mode: "On-site", fee: "₹30,000", websitePath: "/courses/gd-pi" }), {
    duration: "3 Months",
    mode: "On-site",
    fee: "₹30,000",
    websiteUrl: `${PUBLIC_SITE_URL}/courses/gd-pi`,
  });
  assert.deepEqual(courseOverview("garbage"), { duration: null, mode: null, fee: null, websiteUrl: null });
  assert.equal(courseOverview({ websitePath: "//evil.example" }).websiteUrl, null);
  assert.equal(courseOverview({ websitePath: "https://evil.example" }).websiteUrl, null);
  assert.equal(courseOverview({ duration: 42 }).duration, null);
});
