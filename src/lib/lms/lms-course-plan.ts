// Pure planning for syncing the public website course list into the LMS as
// overview-only courses. No imports: also loaded directly by
// scripts/lms-course-sync.mjs (Node type stripping), so only erasable TS syntax.

export interface WebsiteCourse {
  slug: string;
  name: string;
  description?: string;
  path?: string;
  price?: string;
  duration?: string;
  courseMode?: string;
}

export interface CatalogItem {
  marketingSlug: string;
  duration?: string | null;
  price?: string | null;
}

export interface MarketingCourse {
  id: string;
  slug: string;
  status: string;
  fee: string | number | null;
  duration: string | null;
}

export interface ExistingLmsCourse {
  id: string;
  slug: string;
  title: string;
  marketingCourseId: string | null;
  metadata: unknown;
}

export interface TargetCourse {
  slug: string;
  title: string;
  description: string | null;
  marketingSlug: string | null;
  marketingCourseId: string | null;
  metadata: {
    overviewOnly: true;
    duration: string | null;
    mode: string | null;
    fee: string | null;
    websitePath: string | null;
    source: "website-course-registry";
  };
}

export type PlanAction = "create" | "exists" | "blocked";

export interface PlanEntry {
  target: TargetCourse;
  action: PlanAction;
  existingId: string | null;
  reason: string | null;
}

export interface SemanticMatch {
  lmsSlug: string;
  lmsTitle: string;
  websiteSlug: string;
  websiteTitle: string;
  score: number;
}

export interface SyncPlan {
  entries: PlanEntry[];
  semanticMatches: SemanticMatch[];
  problems: string[];
}

export const EXPECTED_WEBSITE_COURSE_COUNT = 11;

const MODE_LABEL: Record<string, string> = {
  onsite: "On-site",
  online: "Online",
  blended: "Blended (on-site + online)",
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function humanDuration(iso: string | null | undefined): string | null {
  const m = /^P(\d+)([DWMY])$/.exec(iso ?? "");
  if (!m) return null;
  const unit = ({ D: "day", W: "week", M: "month", Y: "year" } as Record<string, string>)[m[2]!];
  return `${m[1]} ${unit}${m[1] === "1" ? "" : "s"}`;
}

export function modeLabel(courseMode: string | null | undefined): string | null {
  return courseMode ? MODE_LABEL[courseMode] ?? null : null;
}

function normalizeTitle(title: string): string[] {
  const stop = new Set(["the", "and", "of", "a", "an", "in", "your", "dgca", "complied", "course", "program"]);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !stop.has(w));
}

export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a));
  const tb = new Set(normalizeTitle(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function buildTargets(params: {
  websiteCourses: WebsiteCourse[];
  catalogItems: CatalogItem[];
  marketingCourses: MarketingCourse[];
  toMarketingSlug: (websiteSlug: string) => string;
  feeLabel: (slug: string, dbFee: string | number | null | undefined) => string | null;
}): TargetCourse[] {
  const published = new Map(
    params.marketingCourses.filter((c) => c.status === "PUBLISHED").map((c) => [c.slug, c]),
  );
  return params.websiteCourses.map((c) => {
    const marketing = published.get(params.toMarketingSlug(c.slug)) ?? null;
    const catalog = params.catalogItems.find((i) => i.marketingSlug === c.slug) ?? null;
    const fee = marketing
      ? params.feeLabel(marketing.slug, marketing.fee)
      : catalog?.price ?? params.feeLabel(c.slug, c.price ?? null);
    return {
      slug: c.slug,
      title: c.name,
      description: c.description ?? null,
      marketingSlug: marketing?.slug ?? null,
      marketingCourseId: marketing?.id ?? null,
      metadata: {
        overviewOnly: true,
        duration: marketing?.duration ?? catalog?.duration ?? humanDuration(c.duration),
        mode: modeLabel(c.courseMode),
        fee: fee ?? null,
        websitePath: c.path ?? null,
        source: "website-course-registry",
      },
    };
  });
}

export function buildSyncPlan(targets: TargetCourse[], existing: ExistingLmsCourse[]): SyncPlan {
  const problems: string[] = [];
  if (targets.length !== EXPECTED_WEBSITE_COURSE_COUNT) {
    problems.push(`expected ${EXPECTED_WEBSITE_COURSE_COUNT} website courses, found ${targets.length}`);
  }
  const seenSlugs = new Set<string>();
  const seenMarketing = new Set<string>();
  for (const t of targets) {
    if (!SLUG_RE.test(t.slug)) problems.push(`invalid slug "${t.slug}"`);
    if (seenSlugs.has(t.slug)) problems.push(`duplicate target slug "${t.slug}"`);
    seenSlugs.add(t.slug);
    if (t.marketingCourseId) {
      if (seenMarketing.has(t.marketingCourseId)) problems.push(`marketing course linked twice (${t.slug})`);
      seenMarketing.add(t.marketingCourseId);
    }
  }

  const bySlug = new Map(existing.map((c) => [c.slug, c]));
  const byMarketing = new Map(
    existing.filter((c) => c.marketingCourseId).map((c) => [c.marketingCourseId as string, c]),
  );

  const entries: PlanEntry[] = targets.map((target) => {
    const sameSlug = bySlug.get(target.slug);
    if (sameSlug) return { target, action: "exists", existingId: sameSlug.id, reason: null };
    const linked = target.marketingCourseId ? byMarketing.get(target.marketingCourseId) : undefined;
    if (linked) {
      return {
        target,
        action: "blocked",
        existingId: linked.id,
        reason: `marketing course already linked to LMS course "${linked.slug}"`,
      };
    }
    return { target, action: "create", existingId: null, reason: null };
  });

  const semanticMatches: SemanticMatch[] = [];
  for (const lms of existing) {
    if (seenSlugs.has(lms.slug)) continue;
    for (const t of targets) {
      const score = titleSimilarity(lms.title, t.title);
      if (score >= 0.5) {
        semanticMatches.push({ lmsSlug: lms.slug, lmsTitle: lms.title, websiteSlug: t.slug, websiteTitle: t.title, score });
      }
    }
  }

  return { entries, semanticMatches, problems };
}

/** Field-by-field differences between a stored LMS course and its target. */
export function diffAgainstTarget(
  stored: { slug: string; title: string; marketingCourseId: string | null; metadata: unknown },
  target: TargetCourse,
): string[] {
  const diffs: string[] = [];
  if (stored.title !== target.title) diffs.push(`title "${stored.title}" != "${target.title}"`);
  if (stored.marketingCourseId !== target.marketingCourseId) diffs.push("marketingCourseId differs");
  const m = (stored.metadata && typeof stored.metadata === "object" ? stored.metadata : {}) as Record<string, unknown>;
  for (const key of ["overviewOnly", "duration", "mode", "fee", "websitePath"] as const) {
    if ((m[key] ?? null) !== (target.metadata[key] ?? null)) {
      diffs.push(`metadata.${key} ${JSON.stringify(m[key] ?? null)} != ${JSON.stringify(target.metadata[key])}`);
    }
  }
  return diffs;
}
